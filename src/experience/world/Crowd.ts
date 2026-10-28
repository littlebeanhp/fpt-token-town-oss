import {
  Box3,
  BoxGeometry,
  Color,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Interpolant,
  type Material,
  type Object3D,
} from 'three/webgpu';
import { float, smoothstep, uniform, uv } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { VehiclePart } from '@/types/vehicle';
import { TintedInstances } from '../core/TintedInstances';
import {
  QUEUE_ARRIVAL_DISTANCE,
  QUEUE_SPACING,
  QUEUE_STEP_SECONDS,
  createQueueLayout,
  queueSlotCount,
  queueTrackIndex,
  runnerCount,
  sampleQueueEntry,
  sampleQueueFlow,
  type QueueLayout,
  type QueuePoint,
  type QueueSite,
} from './QueueLayout';
import {
  BLOCK_PITCH,
  LOT_HALF,
  SIDEWALK_HEIGHT,
  blockIndex,
  blockKeyAt,
  createRandom,
  isDistrictBlock,
} from './layout';

export type CrowdSite = QueueSite;

interface Person {
  x: number;
  z: number;
  heading: number;
  phase: number;
  scale: number;
  /** Walkers loop a lot perimeter; standing people idle in place. */
  walker: boolean;
  centerX: number;
  centerZ: number;
  start: number;
  speed: number;
  index: number;
  /** Some visitors wear their district's brand color. */
  brand?: string;
  /** Selects the voxel person or one of the animated branded characters. */
  character: CharacterKind;
  /** The guide on the speech studio's plaza, who always wears the FPT shirt. */
  host?: boolean;
  /** Queue visitors keep their identity while cycling through queue and runner states. */
  flow?: CrowdFlow;
  flowSlot: number;
  routeVariant: number;
  moving: boolean;
  stride: number;
  /** Instance of this person's soft trailing shadow, and whether it is currently drawn. */
  trail: number;
  trailing: boolean;
}

const SHIRTS = [
  '#e05d5d',
  '#4f7cc9',
  '#f2c14e',
  '#57a773',
  '#9b6fd1',
  '#f08a4b',
  '#3d5a80',
  '#e8e8e8',
  '#34343c',
  '#d97aa6',
  '#6cc4c4',
];
const PANTS = ['#2f3b52', '#4a4a4a', '#6b5b45', '#1f2a44', '#8a7a66', '#354f52'];
const SKIN = ['#f1c9a5', '#e0ac7e', '#c68642', '#8d5524', '#ffdbac', '#a86b3c'];
const HAIR = ['#2b1d14', '#4a3021', '#1b1b1b', '#8b5a2b', '#d8b45a', '#9a9a9a'];
const WALK_HALF = LOT_HALF - 0.6;
const WALK_PERIMETER = WALK_HALF * 8;

type CharacterKind = 'voxel' | AnimatedCharacterKind;
type AnimatedCharacterKind = 'grab' | 'fpt';

interface CharacterSpec {
  label: string;
  url: string;
  body: string;
  left: string;
  right: string;
}

const CHARACTER_KINDS: AnimatedCharacterKind[] = ['grab', 'fpt'];
const CHARACTER_SPECS: Record<AnimatedCharacterKind, CharacterSpec> = {
  grab: {
    label: 'Grab rider',
    url: '/models/grab-walk-v2.glb',
    body: 'bodyobj',
    left: 'leftmeshobj001',
    right: 'rightmeshobj002',
  },
  fpt: {
    label: 'FPT visitor',
    url: '/models/fpt-walk-v2.glb',
    body: 'texturedmeshobj',
    left: 'texturedmeshobj001',
    right: 'texturedmeshobj002',
  },
};
/**
 * Where the guide waits, measured from their lot's centre: the front corner of the plaza, a
 * clear metre outside the roped queue and ahead of the runners' lane. The offset mirrors with
 * the queue, so it stays out of the line whichever way the serpentine runs.
 * `tests/town-host.test.ts` holds that clearance.
 */
export const HOST_SPOT = { x: 2.6, z: 2.3, heading: 0.3 } as const;
/** Hair-top height of a voxel person at scale 1, so the rider matches their stature. */
const PERSON_HEIGHT = 0.595;
const QUEUE_SHIFT_SECONDS = 0.2;
const STRIDE_RADIANS_PER_UNIT = 13;
/** Visitors leaving a house slip this far to the runners' side of the doorway, then cut across. */
const EXIT_SHIFT = 0.16;
const EXIT_DIAGONAL = 0.8;
/** The soft streak a moving person leaves behind: a ground-hugging, fading dark quad. */
const TRAIL_LENGTH = 0.65;
const TRAIL_WIDTH = 0.2;
const TRAIL_LIFT = 0.006;

interface RunnerRoute {
  points: QueuePoint[];
  cumulative: number[];
  length: number;
}

interface CrowdFlow {
  layout: QueueLayout;
  routes: RunnerRoute[];
  queueSlots: number;
  /** Runners circling this building; busier districts keep more of them moving. */
  runners: number;
  totalSlots: number;
}

interface CharacterAsset {
  body: CharacterPart;
  left: CharacterLeg;
  right: CharacterLeg;
  material: Material;
  duration: number;
}

interface CharacterPart {
  geometry: BufferGeometry;
  rest: Matrix4;
}

interface CharacterLeg extends CharacterPart {
  parent: Matrix4;
  mesh: Matrix4;
  position: Interpolant;
  quaternion: Interpolant;
  scale: Vector3;
}

interface CharacterBatches {
  body: TintedInstances;
  left: TintedInstances;
  right: TintedInstances;
}

/**
 * Loads a split animated character once. Body and legs remain three instanced batches;
 * animation tracks are sampled per person at their own distance-derived phase.
 */
async function loadCharacterAsset(spec: CharacterSpec): Promise<CharacterAsset> {
  const gltf = await new GLTFLoader().loadAsync(spec.url);
  gltf.scene.updateWorldMatrix(true, true);
  let body: Mesh | undefined, leftPivot: Object3D | undefined, rightPivot: Object3D | undefined;
  const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  gltf.scene.traverse((node) => {
    const name = nameKey(node.name);
    if (node instanceof Mesh && name === spec.body) body = node;
    else if (!(node instanceof Mesh) && name === spec.left) leftPivot = node;
    else if (!(node instanceof Mesh) && name === spec.right) rightPivot = node;
  });
  const childMesh = (pivot?: Object3D) => {
    let result: Mesh | undefined;
    pivot?.traverse((node) => {
      if (!result && node instanceof Mesh) result = node;
    });
    return result;
  };
  const leftMesh = childMesh(leftPivot),
    rightMesh = childMesh(rightPivot),
    clip = gltf.animations[0];
  if (!body || !leftPivot || !rightPivot || !leftMesh || !rightMesh || !clip)
    throw new Error(`${spec.url} requires body, left leg, right leg, and an animation`);

  const box = new Box3().setFromObject(gltf.scene);
  const height = box.max.y - box.min.y;
  const normalizer = new Matrix4()
    .makeScale(1 / height, 1 / height, 1 / height)
    .multiply(
      new Matrix4().makeTranslation(
        -(box.min.x + box.max.x) / 2,
        -box.min.y,
        -(box.min.z + box.max.z) / 2,
      ),
    );
  const part = (source: Mesh): CharacterPart => ({
    geometry: source.geometry.clone(),
    rest: normalizer.clone().multiply(source.matrixWorld),
  });
  const leg = (pivot: Object3D, source: Mesh): CharacterLeg => {
    const position = clip.tracks.find((track) => track.name === `${pivot.name}.position`),
      quaternion = clip.tracks.find((track) => track.name === `${pivot.name}.quaternion`);
    if (!position || !quaternion) throw new Error(`missing animation tracks for ${pivot.name}`);
    return {
      ...part(source),
      parent: normalizer.clone().multiply(pivot.parent!.matrixWorld),
      mesh: pivot.matrixWorld.clone().invert().multiply(source.matrixWorld),
      position: position.InterpolantFactoryMethodLinear(),
      quaternion: quaternion.InterpolantFactoryMethodLinear(),
      scale: pivot.scale.clone(),
    };
  };
  // Rebuilt on three/webgpu's own material so it matches the rest of the city; the loader
  // returns a core MeshStandardMaterial, which the renderer would otherwise have to convert.
  const loaded = (
    Array.isArray(body.material) ? body.material[0] : body.material
  ) as MeshStandardMaterial;
  const material = new MeshStandardMaterial({
    map: loaded.map ?? null,
    roughnessMap: loaded.roughnessMap ?? null,
    metalnessMap: loaded.metalnessMap ?? null,
    roughness: loaded.roughness,
    metalness: loaded.metalness,
  });
  return {
    body: part(body),
    left: leg(leftPivot, leftMesh),
    right: leg(rightPivot, rightMesh),
    material,
    duration: clip.duration,
  };
}

/**
 * Which model a person is drawn with. The FPT livery belongs to the guide alone, so exactly
 * one of them stands in town and the mark over their head always means the same person. Grab
 * stays on idle visitors and road riders, everyone else is a voxel visitor, and a missing
 * file simply leaves them voxel too.
 */
export function pickCharacter(
  person: Pick<Person, 'host' | 'walker' | 'flow'>,
  roll: number,
  assets: Partial<Record<AnimatedCharacterKind, CharacterAsset>>,
): CharacterKind {
  if (person.host) return assets.fpt ? 'fpt' : 'voxel';
  if (assets.grab && !person.walker && !person.flow && roll < 0.4) return 'grab';
  return 'voxel';
}

/** Shared across `preload` and `create`, so the characters are fetched and parsed once. */
let characterLoads: Promise<PromiseSettledResult<CharacterAsset>[]> | undefined;

/**
 * Voxel visitors: a queue in front of every district, idle loiterers, and pedestrians looping
 * nearby lots. Four instanced batches (legs, torso, head, hair) render every person, and a
 * separate three-part batches render the branded animated characters.
 */
export class Crowd {
  readonly root = new Group();
  private geometry = new BoxGeometry(1, 1, 1);
  private material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
  private legs: TintedInstances;
  private torsos: TintedInstances;
  private heads: TintedInstances;
  private hair: TintedInstances;
  private characterBatches: Partial<Record<AnimatedCharacterKind, CharacterBatches>> = {};
  private characterAssets: Partial<Record<AnimatedCharacterKind, CharacterAsset>> = {};
  private people: Person[] = [];
  private host?: Person;
  private trails: TintedInstances;
  private trailGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private trailMaterial = new MeshBasicNodeMaterial({
    color: '#161b29',
    transparent: true,
    depthWrite: false,
  });
  private matrix = new Matrix4();
  private position = new Vector3();
  private scale = new Vector3();
  private rotation = new Quaternion();
  private euler = new Euler(0, 0, 0, 'YXZ');
  private color = new Color();
  private flowFrom = { x: 0, z: 0, heading: 0 };
  private flowTo = { x: 0, z: 0, heading: 0 };
  private riderPartMatrix = new Matrix4();
  private riderLocalMatrix = new Matrix4();
  private riderPosition = new Vector3();
  private riderQuaternion = new Quaternion();

  /**
   * Starts downloading the branded characters. Called as soon as the module arrives so the two
   * files travel alongside the district houses instead of queueing behind them.
   */
  static preload() {
    return (characterLoads ??= Promise.allSettled(
      CHARACTER_KINDS.map((kind) => loadCharacterAsset(CHARACTER_SPECS[kind])),
    ));
  }

  /** Loads character meshes, then builds the crowd. Missing variants fall back to voxels. */
  static async create(sites: CrowdSite[]) {
    const loaded = await Crowd.preload();
    const assets: Partial<Record<AnimatedCharacterKind, CharacterAsset>> = {};
    for (let i = 0; i < CHARACTER_KINDS.length; i++) {
      const kind = CHARACTER_KINDS[i],
        result = loaded[i];
      if (result.status === 'fulfilled') assets[kind] = result.value;
      else
        console.warn(
          `Crowd: ${CHARACTER_SPECS[kind].label} unavailable, using voxel people instead`,
          result.reason,
        );
    }
    return new Crowd(sites, assets);
  }

  private constructor(
    sites: CrowdSite[],
    assets: Partial<Record<AnimatedCharacterKind, CharacterAsset>>,
  ) {
    const random = createRandom(7331);
    for (const site of sites) this.spawnSite(site, random);
    for (let i = -2; i <= 2; i++)
      for (let j = -2; j <= 2; j++) {
        if (isDistrictBlock(i, j) && !(Math.abs(i) === 1 && j === 0)) continue;
        for (let n = 0; n < 4; n++) this.spawnWalker(i, j, random);
      }
    // Each visual variant addresses its own instanced batches and therefore its own slot range.
    let voxels = 0;
    const characterCounts: Record<AnimatedCharacterKind, number> = { grab: 0, fpt: 0 };
    for (const person of this.people) {
      const roll = random();
      person.character = pickCharacter(person, roll, assets);
      person.index = person.character === 'voxel' ? voxels++ : characterCounts[person.character]++;
    }
    this.legs = new TintedInstances(this.geometry, this.material, voxels * 2, true);
    this.torsos = new TintedInstances(this.geometry, this.material, voxels, true);
    this.heads = new TintedInstances(this.geometry, this.material, voxels, true);
    this.hair = new TintedInstances(this.geometry, this.material, voxels, true);
    this.root.add(this.legs.mesh, this.torsos.mesh, this.heads.mesh, this.hair.mesh);
    for (const kind of CHARACTER_KINDS) {
      const asset = assets[kind],
        count = characterCounts[kind];
      if (!asset) continue;
      this.characterAssets[kind] = asset;
      if (count === 0) continue;
      const batches: CharacterBatches = {
        body: new TintedInstances(asset.body.geometry, asset.material, count, true),
        left: new TintedInstances(asset.left.geometry, asset.material, count, true),
        right: new TintedInstances(asset.right.geometry, asset.material, count, true),
      };
      this.characterBatches[kind] = batches;
      this.root.add(batches.body.mesh, batches.left.mesh, batches.right.mesh);
    }
    const pick = (list: string[]) => this.color.set(list[Math.floor(random() * list.length)]);
    for (const person of this.people) {
      const key = blockKeyAt(person.x, person.z);
      if (person.character !== 'voxel') {
        // White leaves the baked livery alone; emphasis still dims it with everything else.
        const white = this.color.set('#ffffff'),
          batches = this.characterBatches[person.character]!;
        batches.body.add(this.matrix, white, key);
        batches.left.add(this.matrix, white, key);
        batches.right.add(this.matrix, white, key);
        continue;
      }
      const pants = pick(PANTS).clone();
      this.legs.add(this.matrix, pants, key);
      this.legs.add(this.matrix, pants, key);
      this.torsos.add(this.matrix, person.brand ? this.color.set(person.brand) : pick(SHIRTS), key);
      this.heads.add(this.matrix, pick(SKIN), key);
      this.hair.add(this.matrix, pick(HAIR), key);
    }
    // The streak is brightest at the feet (v = 0) and fades to nothing behind, softened at the sides.
    this.trailMaterial.opacityNode = uniform(0.4)
      .mul(smoothstep(0, 0.4, uv().x))
      .mul(float(1).sub(smoothstep(0.6, 1, uv().x)))
      .mul(float(1).sub(uv().y));
    this.trails = new TintedInstances(
      this.trailGeometry,
      this.trailMaterial,
      this.people.length,
      true,
    );
    this.trails.mesh.name = 'crowd-trails';
    this.trails.mesh.castShadow = false;
    this.trails.mesh.receiveShadow = false;
    this.trails.mesh.frustumCulled = false;
    this.trails.mesh.renderOrder = 2;
    this.root.add(this.trails.mesh);
    // Hidden until the person first moves.
    const hidden = new Matrix4().makeScale(0, 0, 0),
      white = new Color('#ffffff');
    for (const person of this.people)
      person.trail = this.trails.add(hidden, white, blockKeyAt(person.x, person.z));
    this.update(0);
  }

  /** Bake the already-loaded Grab into a seated road pose; Traffic owns these copies. */
  createGrabRiderParts(): VehiclePart[] | undefined {
    const asset = this.characterAssets.grab;
    if (!asset) return undefined;
    const material = asset.material.clone();
    const bikeTransform = new Matrix4()
      .makeTranslation(0, 0.12, -0.06)
      .multiply(new Matrix4().makeScale(0.65, 0.65, 0.65));
    // Rigid legs pivot forward from the hips, with the original mesh texture preserved.
    const seatedLeg = new Matrix4()
      .makeTranslation(0, 0.36, 0)
      .multiply(new Matrix4().makeRotationX(-0.65))
      .multiply(new Matrix4().makeTranslation(0, -0.36, 0));
    return (['body', 'left', 'right'] as const).map((name) => {
      const part = asset[name];
      const transform = bikeTransform.clone();
      if (name !== 'body') transform.multiply(seatedLeg);
      transform.multiply(part.rest);
      return {
        name: `grab-asset-${name}`,
        geometry: part.geometry.clone().applyMatrix4(transform),
        material,
        color: new Color('#ffffff'),
      };
    });
  }

  private spawn(
    values: Partial<Person> & Pick<Person, 'x' | 'z' | 'heading'>,
    random: () => number,
  ) {
    const person: Person = {
      phase: random() * Math.PI * 2,
      scale: 1.08 + random() * 0.2,
      walker: false,
      character: 'voxel',
      flowSlot: -1,
      routeVariant: Math.floor(random() * 3),
      moving: false,
      stride: 0,
      trail: -1,
      trailing: false,
      centerX: 0,
      centerZ: 0,
      start: 0,
      speed: 0,
      index: this.people.length,
      ...values,
    };
    this.people.push(person);
    return person;
  }
  private spawnSite(site: CrowdSite, random: () => number) {
    const lotX = blockIndex(site.x) * BLOCK_PITCH;
    const layout = createQueueLayout(site);
    const queueSlots = queueSlotCount(layout);
    const runners = runnerCount(layout);
    const tail = { x: 0, z: 0, heading: 0 };
    this.sampleQueueSlot(layout, queueSlots - 1, tail);
    const routes = [0, 1, 2].map((lane) => this.createRunnerRoute(site, layout, tail, lane));
    const flow: CrowdFlow = {
      layout,
      routes,
      queueSlots,
      runners,
      totalSlots: queueSlots + runners + 1,
    };
    for (let n = 0; n < flow.totalSlots; n++) {
      const person = this.spawn(
        {
          x: site.x,
          z: site.front,
          heading: 0,
          flow,
          flowSlot: n,
        },
        random,
      );
      if (random() < 0.3) person.brand = site.color;
    }
    for (let n = 0; n < 5; n++)
      this.spawn(
        {
          x: lotX + (n % 2 === 0 ? -1 : 1) * (2.65 + random() * 0.18),
          z: site.front + 0.45 + random() * 1.1,
          heading: random() * Math.PI * 2,
        },
        random,
      );
    if (site.host) {
      const lotZ = blockIndex(site.z) * BLOCK_PITCH;
      // Standing, turned towards the locked camera, so the mark over their head faces the view.
      this.host = this.spawn(
        {
          x: lotX + layout.side * HOST_SPOT.x,
          z: lotZ + HOST_SPOT.z,
          heading: layout.side * HOST_SPOT.heading,
          brand: site.color,
          host: true,
        },
        random,
      );
    }
  }
  private spawnWalker(i: number, j: number, random: () => number) {
    this.spawn(
      {
        x: i * BLOCK_PITCH,
        z: j * BLOCK_PITCH + WALK_HALF,
        heading: 0,
        walker: true,
        centerX: i * BLOCK_PITCH,
        centerZ: j * BLOCK_PITCH,
        start: random() * WALK_PERIMETER,
        speed: (0.35 + random() * 0.3) * (random() < 0.5 ? -1 : 1),
      },
      random,
    );
  }

  private sampleQueueSlot(
    layout: QueueLayout,
    slot: number,
    out: QueuePoint & { heading: number },
  ) {
    const distance = 0.16 + slot * QUEUE_SPACING;
    // Convert a distance behind the doorway to sampleQueueFlow's forward-travel parameter.
    return sampleQueueFlow(layout, layout.length + QUEUE_ARRIVAL_DISTANCE - distance, out);
  }

  private createRunnerRoute(
    site: QueueSite,
    layout: QueueLayout,
    tail: QueuePoint,
    lane: number,
  ): RunnerRoute {
    const front = { x: 0, z: 0, heading: 0 };
    this.sampleQueueSlot(layout, 0, front);
    // The circuit mirrors with the queue, so runners always leave by the open end of the first row.
    const side = layout.side * (2.65 + lane * 0.17);
    // Runners come back out of the same lit doorway the line walks into.
    const inside = sampleQueueEntry(layout, layout.inside, { x: 0, z: 0, heading: 0 });
    const points: QueuePoint[] = [
      // Leave from the runners' side of the doorway and cut across the plaza, so the way out
      // never retraces the straight line the queue walks in on.
      { x: inside.x + layout.side * EXIT_SHIFT, z: inside.z },
      { x: layout.path[1].x + layout.side * EXIT_DIAGONAL, z: site.front + 0.4 },
      { x: site.x + side, z: site.front + 0.4 },
      { x: site.x + side, z: site.front - 4.55 - lane * 0.18 },
      { x: site.x - side, z: site.front - 4.55 - lane * 0.18 },
      { x: site.x - side, z: site.front + 0.85 },
      { x: tail.x, z: tail.z },
    ];
    const cumulative = [0];
    for (let i = 1; i < points.length; i++)
      cumulative.push(
        cumulative[i - 1] +
          Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z),
      );
    return { points, cumulative, length: cumulative.at(-1)! };
  }

  private walk(person: Person, elapsed: number) {
    const s = WALK_HALF;
    const u =
      (((person.start + elapsed * person.speed) % WALK_PERIMETER) + WALK_PERIMETER) %
      WALK_PERIMETER;
    const segment = Math.floor(u / (2 * s)),
      t = u - segment * 2 * s;
    let dx = 0,
      dz = 0;
    if (segment === 0) {
      person.x = person.centerX - s + t;
      person.z = person.centerZ + s;
      dx = 1;
    } else if (segment === 1) {
      person.x = person.centerX + s;
      person.z = person.centerZ + s - t;
      dz = -1;
    } else if (segment === 2) {
      person.x = person.centerX + s - t;
      person.z = person.centerZ - s;
      dx = -1;
    } else {
      person.x = person.centerX - s;
      person.z = person.centerZ - s + t;
      dz = 1;
    }
    const direction = Math.sign(person.speed);
    person.heading = Math.atan2(dx * direction, dz * direction);
    person.moving = true;
    person.stride =
      (person.start + elapsed * Math.abs(person.speed)) * STRIDE_RADIANS_PER_UNIT + person.phase;
  }

  private sampleRunner(route: RunnerRoute, distance: number, out: Person | typeof this.flowFrom) {
    const d = Math.max(0, Math.min(route.length, distance));
    let segment = 1;
    while (segment < route.cumulative.length - 1 && d > route.cumulative[segment]) segment++;
    const a = route.points[segment - 1],
      b = route.points[segment],
      start = route.cumulative[segment - 1],
      length = route.cumulative[segment] - start,
      t = length ? (d - start) / length : 0,
      dx = b.x - a.x,
      dz = b.z - a.z;
    out.x = a.x + dx * t;
    out.z = a.z + dz * t;
    out.heading = Math.atan2(dx, dz);
  }

  private moveFlow(person: Person, elapsed: number) {
    const flow = person.flow!,
      intervalProgress = (elapsed % QUEUE_STEP_SECONDS) / QUEUE_STEP_SECONDS,
      track = queueTrackIndex(person.flowSlot, elapsed, flow.queueSlots, flow.runners),
      route = flow.routes[person.routeVariant];
    if (track === flow.totalSlots - 1) {
      this.sampleQueueSlot(flow.layout, 0, this.flowFrom);
      const progress = Math.min(intervalProgress / 0.4, 1);
      const dx = route.points[0].x - this.flowFrom.x,
        dz = route.points[0].z - this.flowFrom.z;
      person.x = this.flowFrom.x + dx * progress;
      person.z = this.flowFrom.z + dz * progress;
      person.heading = Math.atan2(dx, dz);
      person.moving = progress < 1;
      person.stride = progress * Math.hypot(dx, dz) * STRIDE_RADIANS_PER_UNIT;
      return;
    }
    if (track < flow.queueSlots) {
      this.sampleQueueSlot(flow.layout, track, this.flowTo);
      if (track + 1 < flow.queueSlots) this.sampleQueueSlot(flow.layout, track + 1, this.flowFrom);
      else this.sampleRunner(route, route.length, this.flowFrom);
      const raw = Math.min(intervalProgress / (QUEUE_SHIFT_SECONDS / QUEUE_STEP_SECONDS), 1),
        progress = raw * raw * (3 - 2 * raw);
      person.x = this.flowFrom.x + (this.flowTo.x - this.flowFrom.x) * progress;
      person.z = this.flowFrom.z + (this.flowTo.z - this.flowFrom.z) * progress;
      person.heading = this.flowTo.heading;
      person.moving = raw < 1;
      // One deliberate step, returning both legs to rest for the remainder of the interval.
      person.stride = Math.PI * 2 * progress;
      return;
    }
    const rank = flow.queueSlots + flow.runners - 1 - track,
      progress = (rank + intervalProgress) / flow.runners,
      // Vary spacing smoothly while preserving exactly one arrival each half-second.
      stagger = Math.sin(progress * Math.PI) * Math.sin(person.phase) * 0.018,
      distance = (progress + stagger) * route.length;
    this.sampleRunner(route, distance, person);
    person.moving = true;
    person.stride = distance * STRIDE_RADIANS_PER_UNIT + person.phase;
  }

  /** Writes one body part: a local offset from the person's feet, rotated by their heading. */
  private compose(
    target: TintedInstances,
    index: number,
    person: Person,
    heading: number,
    tilt: number,
    ox: number,
    oy: number,
    oz: number,
    w: number,
    h: number,
    d: number,
  ) {
    const cos = Math.cos(heading),
      sin = Math.sin(heading);
    this.euler.set(tilt, heading, 0);
    this.rotation.setFromEuler(this.euler);
    this.position.set(
      person.x + ox * cos + oz * sin,
      SIDEWALK_HEIGHT + oy,
      person.z - ox * sin + oz * cos,
    );
    this.matrix.compose(this.position, this.rotation, this.scale.set(w, h, d));
    target.setMatrix(index, this.matrix);
  }
  private composeLeg(person: Person, heading: number, side: number, swing: number) {
    const k = person.scale,
      length = 0.2 * k,
      angle = swing * side;
    this.compose(
      this.legs,
      person.index * 2 + (side + 1) / 2,
      person,
      heading,
      angle,
      side * 0.045 * k,
      length - (length / 2) * Math.cos(angle),
      -(length / 2) * Math.sin(angle),
      0.075 * k,
      length,
      0.09 * k,
    );
  }

  /** Samples a split-leg clip per instance while the shared body stays rigid and instanced. */
  private composeCharacter(person: Person, heading: number, bob: number, k: number) {
    const kind = person.character as AnimatedCharacterKind,
      asset = this.characterAssets[kind]!,
      batches = this.characterBatches[kind]!;
    this.euler.set(0, heading, 0);
    this.rotation.setFromEuler(this.euler);
    this.position.set(person.x, SIDEWALK_HEIGHT + bob, person.z);
    const height = PERSON_HEIGHT * k;
    this.matrix.compose(this.position, this.rotation, this.scale.set(height, height, height));
    this.riderPartMatrix.copy(this.matrix).multiply(asset.body.rest);
    batches.body.setMatrix(person.index, this.riderPartMatrix);

    const cycle = person.moving
      ? ((((person.stride / (Math.PI * 2)) % 1) + 1) % 1) * asset.duration
      : -1;
    this.composeCharacterLeg(person.index, cycle, asset.left, batches.left);
    this.composeCharacterLeg(person.index, cycle, asset.right, batches.right);
  }

  private composeCharacterLeg(
    index: number,
    cycle: number,
    leg: CharacterLeg,
    batch: TintedInstances,
  ) {
    if (cycle < 0) this.riderPartMatrix.copy(leg.rest);
    else {
      this.riderPosition.fromArray(leg.position.evaluate(cycle));
      this.riderQuaternion.fromArray(leg.quaternion.evaluate(cycle));
      this.riderLocalMatrix.compose(this.riderPosition, this.riderQuaternion, leg.scale);
      this.riderPartMatrix.copy(leg.parent).multiply(this.riderLocalMatrix).multiply(leg.mesh);
    }
    this.riderPartMatrix.premultiply(this.matrix);
    batch.setMatrix(index, this.riderPartMatrix);
  }

  /** One quad per walker: laid behind their heading while they move, collapsed once they stop. */
  private composeTrail(person: Person, k: number) {
    if (!person.moving) {
      if (!person.trailing) return;
      person.trailing = false;
      this.trails.setMatrix(person.trail, this.matrix.makeScale(0, 0, 0));
      return;
    }
    person.trailing = true;
    const length = TRAIL_LENGTH * k;
    this.euler.set(0, person.heading, 0);
    this.rotation.setFromEuler(this.euler);
    this.position.set(
      person.x - Math.sin(person.heading) * length * 0.5,
      SIDEWALK_HEIGHT + TRAIL_LIFT,
      person.z - Math.cos(person.heading) * length * 0.5,
    );
    this.matrix.compose(this.position, this.rotation, this.scale.set(TRAIL_WIDTH * k, 1, length));
    this.trails.setMatrix(person.trail, this.matrix);
  }

  update(elapsed: number) {
    for (const person of this.people) {
      person.moving = false;
      if (person.walker) this.walk(person, elapsed);
      else if (person.flow) this.moveFlow(person, elapsed);
      const k = person.scale;
      this.composeTrail(person, k);
      const cycle = person.moving ? person.stride : elapsed * 2.2 + person.phase;
      const swing = person.moving ? Math.sin(cycle) * 0.55 : 0;
      const bob = person.moving
        ? Math.abs(Math.sin(cycle)) * 0.018 * k
        : Math.sin(cycle) * 0.006 * k;
      const heading =
        person.heading + (person.moving ? 0 : Math.sin(elapsed * 0.6 + person.phase) * 0.12);
      if (person.character !== 'voxel') {
        this.composeCharacter(person, heading, bob, k);
        continue;
      }
      const hip = 0.2 * k + bob;
      this.composeLeg(person, heading, -1, swing);
      this.composeLeg(person, heading, 1, swing);
      this.compose(
        this.torsos,
        person.index,
        person,
        heading,
        0,
        0,
        hip + 0.1 * k,
        0,
        0.2 * k,
        0.2 * k,
        0.12 * k,
      );
      this.compose(
        this.heads,
        person.index,
        person,
        heading,
        0,
        0,
        hip + 0.275 * k,
        0,
        0.15 * k,
        0.15 * k,
        0.15 * k,
      );
      this.compose(
        this.hair,
        person.index,
        person,
        heading,
        0,
        0,
        hip + 0.37 * k,
        -0.01 * k,
        0.16 * k,
        0.05 * k,
        0.16 * k,
      );
    }
    this.trails.commitMatrices();
    this.legs.commitMatrices();
    this.torsos.commitMatrices();
    this.heads.commitMatrices();
    this.hair.commitMatrices();
    for (const kind of CHARACTER_KINDS) {
      const batches = this.characterBatches[kind];
      if (!batches) continue;
      batches.body.commitMatrices();
      batches.left.commitMatrices();
      batches.right.commitMatrices();
    }
  }
  /** World point just above the guide's head, where the outbound link hangs. */
  hostAnchor(target: Vector3) {
    if (!this.host) return null;
    const height = (this.host.character === 'voxel' ? 0.63 : PERSON_HEIGHT) * this.host.scale;
    return target.set(this.host.x, SIDEWALK_HEIGHT + height + 0.05, this.host.z);
  }

  applyEmphasis(emphasisForKey: (key: number) => number) {
    this.trails.applyEmphasis(emphasisForKey);
    this.legs.applyEmphasis(emphasisForKey);
    this.torsos.applyEmphasis(emphasisForKey);
    this.heads.applyEmphasis(emphasisForKey);
    this.hair.applyEmphasis(emphasisForKey);
    for (const kind of CHARACTER_KINDS) {
      const batches = this.characterBatches[kind];
      if (!batches) continue;
      batches.body.applyEmphasis(emphasisForKey);
      batches.left.applyEmphasis(emphasisForKey);
      batches.right.applyEmphasis(emphasisForKey);
    }
  }
  dispose() {
    this.trails.dispose();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
    this.legs.dispose();
    this.torsos.dispose();
    this.heads.dispose();
    this.hair.dispose();
    for (const kind of CHARACTER_KINDS) {
      const batches = this.characterBatches[kind],
        asset = this.characterAssets[kind];
      if (batches) {
        batches.body.dispose();
        batches.left.dispose();
        batches.right.dispose();
      }
      asset?.body.geometry.dispose();
      asset?.left.geometry.dispose();
      asset?.right.geometry.dispose();
      asset?.material.dispose();
    }
    this.geometry.dispose();
    this.material.dispose();
  }
}
