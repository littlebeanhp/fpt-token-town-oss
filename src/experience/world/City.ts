import {
  AdditiveBlending,
  Box3,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  type BufferGeometry,
  type Material,
} from 'three/webgpu';
import { color, float, length, smoothstep, uniform, uv } from 'three/tsl';
import { Resources } from '../core/Resources';
import { isTokenPlaza } from '../simulation/tokenRoutes';
import { TintedInstances } from '../core/TintedInstances';
import {
  BLOCK_PITCH,
  CITY_BLOCKS,
  LOT_HALF,
  LOT_SIZE,
  ROAD_WIDTH,
  SIDEWALK_HEIGHT,
  STREET_BLOCKS,
  LAMP_HEAD_HEIGHT,
  LAMP_OFFSETS,
  blockKey,
  createRandom,
  isBlockInSight,
  isDistrictBlock,
  isParkBlock,
} from './layout';

type Box = [x: number, y: number, z: number, w: number, h: number, d: number];

const BODY_COLORS = ['#cbd0ce', '#c2c9c7', '#d5d8d4'];
const ROOF_COLORS = ['#a6afad', '#9ea8a6', '#b4bab5'];
const STREET_PROP_URL = '/models/street-props-v1.glb';
/** Pack dressing along each district frontage, clear of the queue and the token runners. */
const PROP_KINDS = [
  'barrel',
  'planter-round',
  'planter-wide',
  'planter-small',
  'crate',
  'bench',
] as const;

/** Trees along the plaza's rear rim. */
const PLAZA_TREES = 5;
/** Cells of a park's 3x3 planting grid that carry a tree: the corners and the centre. */
const PARK_TREE_CELLS = [0, 2, 4, 6, 8] as const;

const TREE_URLS = {
  pine: '/models/pin-tree-v1.glb',
  broadleaf: '/models/tree-v1.glb',
  quaternius: '/models/quaternius-tree-v1.glb',
} as const;
type TreeKind = keyof typeof TREE_URLS;
interface TreePlacement {
  x: number;
  z: number;
  key: number;
  height: number;
  rotation: number;
  kind: TreeKind;
}
interface TreePart {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
}
interface PropPlacement {
  x: number;
  z: number;
  key: number;
  rotation: number;
  scale: number;
  kind: string;
}
/** Filler height ranges. The row nearest the camera stays low so it never hides a district. */
function heightRange(i: number, j: number): [number, number] {
  if (j === 2 && Math.abs(i) <= 3) return [0.7, 1.4];
  if (j === 3 && Math.abs(i) <= 3) return [1.4, 3.2];
  if (Math.abs(i) === 2 && Math.abs(j) <= 1) return [1.6, 4.2];
  if (j <= -2) return [2.4, 7.5];
  return [2, 6];
}

/**
 * A compact instanced city. The outer silhouettes fade into camera-relative fog;
 * street details and trees are reserved for the tour neighbourhood.
 */
export class City {
  readonly root = new Group();
  private resources = new Resources();
  private plane = new PlaneGeometry(1, 1);
  private meshes: InstancedMesh[] = [];
  private tinted: TintedInstances[] = [];
  private treePlacements: TreePlacement[];
  private treeParts: TreePart[] = [];
  private treeLoad?: Promise<void>;
  private propPlacements: PropPlacement[];
  private propParts: TreePart[] = [];
  private propLoad?: Promise<void>;
  private treeMatrix = new Matrix4();
  private disposed = false;
  private dummy = new Object3D();
  private scratch = new Color();
  private lampHeads: MeshStandardMaterial;
  private litWindows: MeshStandardMaterial;
  private backdrop = new MeshLambertMaterial({ color: '#ffffff' });
  private poolStrength = uniform(0);
  private poolMaterial: MeshBasicNodeMaterial;

  constructor() {
    const random = createRandom(20260919);
    const r = this.resources;
    this.lampHeads = new MeshStandardMaterial({
      color: '#fff1d6',
      emissive: '#ffcf8a',
      emissiveIntensity: 0.3,
    });
    this.litWindows = new MeshStandardMaterial({
      color: '#98adb4',
      emissive: '#ffd49a',
      emissiveIntensity: 0.05,
      roughness: 0.35,
    });
    // Lamp light pools: soft additive discs that only appear after dusk.
    const falloff = float(1).sub(smoothstep(0, 0.5, length(uv().sub(0.5))));
    this.poolMaterial = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.poolMaterial.colorNode = color('#ffbe6e');
    this.poolMaterial.opacityNode = falloff.mul(falloff).mul(this.poolStrength);
    this.poolMaterial.fog = false;

    const ground = new Mesh(this.plane, r.material('#7f9295'));
    ground.rotation.x = -Math.PI / 2;
    ground.scale.set(1400, 1400, 1);
    ground.receiveShadow = true;
    this.root.add(ground);

    this.buildLots(random);
    this.buildFiller(random);
    this.buildStreets();
    this.buildLamps();
    this.treePlacements = this.createTreePlacements(random);
    this.propPlacements = this.createPropPlacements(random);
  }

  /** Walks the grid, skipping the blocks no locked shot can reach. */
  private blocks(range: number, visit: (i: number, j: number) => void) {
    for (let i = -range; i <= range; i++)
      for (let j = -range; j <= range; j++) if (isBlockInSight(i, j)) visit(i, j);
  }
  private matrix([x, y, z, w, h, d]: Box, rotation = 0) {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, rotation, 0);
    this.dummy.scale.set(w, h, d);
    this.dummy.updateMatrix();
    return this.dummy.matrix;
  }
  private batch(
    geometry: BufferGeometry,
    material: Material,
    boxes: Box[],
    colors?: Color[],
    castShadow = true,
  ) {
    const mesh = new InstancedMesh(geometry, material, Math.max(boxes.length, 1));
    boxes.forEach((box, index) => {
      mesh.setMatrixAt(index, this.matrix(box));
      if (colors) mesh.setColorAt(index, colors[index]);
    });
    mesh.count = boxes.length;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = castShadow;
    this.root.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }
  private tint(geometry: BufferGeometry, material: Material, capacity: number) {
    const batch = new TintedInstances(geometry, material, capacity);
    this.root.add(batch.mesh);
    this.tinted.push(batch);
    return batch;
  }

  private buildLots(random: () => number) {
    let span = 0;
    this.blocks(CITY_BLOCKS, () => span++);
    const lots = this.tint(this.resources.cube, this.resources.material('#ffffff'), span);
    const grass = this.tint(this.resources.cube, this.resources.material('#ffffff'), 4);
    lots.mesh.name = 'sidewalk-lots';
    grass.mesh.name = 'park-grass';
    this.blocks(CITY_BLOCKS, (i, j) => {
      const district = isDistrictBlock(i, j);
      const tone = district ? '#dde6e2' : random() < 0.5 ? '#cfd9d6' : '#d5dcd8';
      lots.add(
        this.matrix([
          i * BLOCK_PITCH,
          SIDEWALK_HEIGHT / 2,
          j * BLOCK_PITCH,
          LOT_SIZE,
          SIDEWALK_HEIGHT,
          LOT_SIZE,
        ]),
        this.scratch.set(tone),
        blockKey(i, j),
      );
      if (isParkBlock(i, j))
        grass.add(
          this.matrix([
            i * BLOCK_PITCH,
            SIDEWALK_HEIGHT + 0.03,
            j * BLOCK_PITCH,
            LOT_SIZE - 1.1,
            0.06,
            LOT_SIZE - 1.1,
          ]),
          this.scratch.set(isTokenPlaza(i, j) ? '#cbd4d8' : '#9dbb8f'),
          blockKey(i, j),
        );
    });
    lots.mesh.castShadow = false;
    grass.mesh.castShadow = false;
  }

  private buildFiller(random: () => number) {
    const bodies: Box[] = [],
      roofs: Box[] = [],
      lit: Box[] = [];
    const bodyColors: Color[] = [],
      roofColors: Color[] = [];
    // One plain house silhouette per background lot. No bevels, roof machinery,
    // window grids or shadow casting: these houses are deliberately out of focus.
    this.blocks(CITY_BLOCKS, (i, j) => {
      if (isDistrictBlock(i, j)) return;
      const [minHeight, maxHeight] = heightRange(i, j);
      const h = minHeight + random() * (maxHeight - minHeight);
      const x = i * BLOCK_PITCH,
        z = j * BLOCK_PITCH;
      const w = 5.4 + random() * 0.8,
        d = 5.1 + random() * 0.9;
      const top = SIDEWALK_HEIGHT + h;
      bodies.push([x, SIDEWALK_HEIGHT + h / 2, z, w, h, d]);
      roofs.push([x, top + 0.08, z, w + 0.18, 0.16, d + 0.18]);
      bodyColors.push(new Color(BODY_COLORS[Math.floor(random() * BODY_COLORS.length)]));
      roofColors.push(new Color(ROOF_COLORS[Math.floor(random() * ROOF_COLORS.length)]));
      // A single window band on the nearest houses keeps the night skyline readable.
      if (Math.max(Math.abs(i), Math.abs(j)) === STREET_BLOCKS && h > 1.4) {
        lit.push([x, SIDEWALK_HEIGHT + h * 0.6, z + d / 2 + 0.015, w * 0.72, 0.28, 0.025]);
      }
    });
    this.batch(this.resources.cube, this.backdrop, bodies, bodyColors, false).name =
      'filler-bodies';
    this.batch(this.resources.cube, this.backdrop, roofs, roofColors, false).name = 'filler-roofs';
    this.batch(this.resources.cube, this.litWindows, lit, undefined, false).name =
      'background-window-bands';
  }

  private buildStreets() {
    const dashes: Box[] = [],
      stripes: Box[] = [];
    const reach = (STREET_BLOCKS + 0.5) * BLOCK_PITCH,
      clear = ROAD_WIDTH / 2 + 1.1;
    const roads: number[] = [];
    for (let k = -CITY_BLOCKS - 1; k <= CITY_BLOCKS; k++) roads.push((k + 0.5) * BLOCK_PITCH);
    const nearCrossing = (value: number) => roads.some((road) => Math.abs(value - road) < clear);
    for (const road of roads) {
      if (Math.abs(road) > reach) continue;
      for (let s = -reach; s <= reach; s += 1.5) {
        if (nearCrossing(s)) continue;
        dashes.push([road, 0.006, s, 0.08, 0.012, 0.7]);
        dashes.push([s, 0.006, road, 0.7, 0.012, 0.08]);
      }
    }
    const offset = ROAD_WIDTH / 2 + 0.5;
    for (const x of roads)
      for (const z of roads) {
        if (Math.abs(x) > reach || Math.abs(z) > reach) continue;
        for (let s = 0; s < 6; s++) {
          const across = -0.9 + s * 0.36;
          stripes.push([x + across, 0.006, z - offset, 0.18, 0.012, 0.7]);
          stripes.push([x + across, 0.006, z + offset, 0.18, 0.012, 0.7]);
          stripes.push([x - offset, 0.006, z + across, 0.7, 0.012, 0.18]);
          stripes.push([x + offset, 0.006, z + across, 0.7, 0.012, 0.18]);
        }
      }
    const paint = this.resources.material('#dbe7df');
    this.batch(this.resources.cube, paint, dashes, undefined, false);
    this.batch(this.resources.cube, paint, stripes, undefined, false);
  }

  private buildLamps() {
    const posts: Box[] = [],
      heads: Box[] = [],
      pools: Box[] = [];
    this.blocks(STREET_BLOCKS, (i, j) => {
      const offsets = isDistrictBlock(i, j) ? LAMP_OFFSETS : LAMP_OFFSETS.slice(0, 4);
      for (const [ox, oz] of offsets) {
        const x = i * BLOCK_PITCH + ox,
          z = j * BLOCK_PITCH + oz;
        // Broad foot, tapered-looking pedestal, slender pole and a capped lantern.
        posts.push([x, SIDEWALK_HEIGHT + 0.045, z, 0.28, 0.09, 0.28]);
        posts.push([x, SIDEWALK_HEIGHT + 0.17, z, 0.14, 0.18, 0.14]);
        posts.push([x, SIDEWALK_HEIGHT + 0.87, z, 0.065, 1.25, 0.065]);
        posts.push([x, SIDEWALK_HEIGHT + 1.54, z, 0.18, 0.06, 0.18]);
        posts.push([x, SIDEWALK_HEIGHT + 1.76, z, 0.23, 0.07, 0.23]);
        heads.push([x, SIDEWALK_HEIGHT + LAMP_HEAD_HEIGHT, z, 0.13, 0.16, 0.13]);
        pools.push([x, SIDEWALK_HEIGHT + 0.012, z, 4.2, 4.2, 1]);
      }
    });
    // Posts are too slender to read in a 1024px shadow map, so they stay out of both shadow
    // passes; the lanterns and their ground glows carry the lamps after dark.
    this.batch(
      this.resources.cube,
      this.resources.material('#39434a'),
      posts,
      undefined,
      false,
    ).name = 'lamp-posts';
    this.batch(this.resources.cube, this.lampHeads, heads, undefined, false).name = 'lamp-heads';
    const poolMesh = new InstancedMesh(this.plane, this.poolMaterial, pools.length);
    pools.forEach(([x, y, z, w, h], index) => {
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.scale.set(w, h, 1);
      this.dummy.updateMatrix();
      poolMesh.setMatrixAt(index, this.dummy.matrix);
    });
    poolMesh.renderOrder = 2;
    this.root.add(poolMesh);
    this.meshes.push(poolMesh);
  }

  private createTreePlacements(random: () => number): TreePlacement[] {
    const spots: [number, number, number][] = [];
    const add = (i: number, j: number, x: number, z: number) =>
      spots.push([i * BLOCK_PITCH + x, j * BLOCK_PITCH + z, blockKey(i, j)]);
    this.blocks(1, (i, j) => {
      if (isTokenPlaza(i, j)) {
        // Keep the centre clear for the future FPT core; trees line the rear rim, spaced out
        // so the row reads as planting rather than a hedge.
        for (let n = 0; n < PLAZA_TREES; n++) add(i, j, -2.8 + n * 1.4, -3.05);
      } else if (isParkBlock(i, j)) {
        // A quincunx on the park's 3x3 grid: four corners and the middle, half the canopy of a
        // full grid for the same spread.
        for (const cell of PARK_TREE_CELLS)
          add(
            i,
            j,
            -2.2 + (cell % 3) * 2.2 + (random() - 0.5) * 0.8,
            -2.2 + Math.floor(cell / 3) * 2.2 + (random() - 0.5) * 0.8,
          );
      } else if (isDistrictBlock(i, j)) {
        // Seeded asymmetry: one on the left, two separated on the right, clear of runners.
        add(i, j, -3.15 - random() * 0.12, -2.25 + random() * 0.8);
        add(i, j, 3.15 + random() * 0.12, -2.6 + random() * 0.65);
        add(i, j, 3.15 + random() * 0.12, 0.8 + random() * 0.65);
      }
    });
    return spots.map(([x, z, key], index) => ({
      x,
      z,
      key,
      height: 1 + random() * 0.45,
      rotation: random() * Math.PI * 2,
      kind: (['pine', 'broadleaf', 'quaternius'] as const)[index % 3],
    }));
  }

  /** Barrels and planters along the district frontages, outside the roped queue. */
  private createPropPlacements(random: () => number): PropPlacement[] {
    const props: PropPlacement[] = [];
    this.blocks(1, (i, j) => {
      if (!isDistrictBlock(i, j) || isParkBlock(i, j)) return;
      // Hug the two front corners of the lot; the middle belongs to the queue.
      for (const side of [-1, 1])
        for (let n = 0; n < 2; n++) {
          props.push({
            x: i * BLOCK_PITCH + side * (2.5 + random() * 0.9),
            z: j * BLOCK_PITCH + 1.2 + n * 1.15 + random() * 0.4,
            key: blockKey(i, j),
            rotation: random() * Math.PI * 2,
            scale: 0.85 + random() * 0.45,
            kind: PROP_KINDS[Math.floor(random() * PROP_KINDS.length)],
          });
        }
    });
    return props;
  }

  /** Loads the street dressing after the preview; one instanced batch per prop kind. */
  loadStreetProps(assetBase = '') {
    return (this.propLoad ??= this.buildStreetProps(assetBase));
  }

  private async buildStreetProps(assetBase: string) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    // The dressing pack is optional: the open edition ships without it and the street stays bare.
    const gltf = await new GLTFLoader()
      .loadAsync(`${assetBase}${STREET_PROP_URL}`)
      .catch(() => null);
    if (!gltf || this.disposed) return;
    gltf.scene.updateWorldMatrix(true, true);
    const parts = new Map<string, TreePart>();
    gltf.scene.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      const loaded = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as MeshStandardMaterial;
      const material = new MeshStandardMaterial({
        vertexColors: geometry.hasAttribute('color'),
        roughness: loaded?.roughness ?? 0.85,
        metalness: 0,
      });
      parts.set(mesh.name, { geometry, material });
      this.propParts.push({ geometry, material });
    });
    for (const kind of PROP_KINDS) {
      const part = parts.get(kind);
      const items = this.propPlacements.filter((prop) => prop.kind === kind);
      if (!part || !items.length) continue;
      const batch = this.tint(part.geometry, part.material, items.length);
      batch.mesh.name = `street-prop-${kind}`;
      for (const item of items) {
        this.dummy.position.set(item.x, SIDEWALK_HEIGHT, item.z);
        this.dummy.rotation.set(0, item.rotation, 0);
        this.dummy.scale.setScalar(item.scale);
        this.dummy.updateMatrix();
        batch.add(this.dummy.matrix, this.scratch.setRGB(1, 1, 1), item.key);
      }
    }
  }

  /** Loads authored tree models after the initial city preview, then instances every part. */
  loadTrees(assetBase = '') {
    return (this.treeLoad ??= this.buildTrees(assetBase));
  }

  private async buildTrees(assetBase: string) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    const loaded = await Promise.allSettled(
      (Object.keys(TREE_URLS) as TreeKind[]).map(async (kind) => {
        const gltf = await loader.loadAsync(`${assetBase}${TREE_URLS[kind]}`);
        gltf.scene.updateWorldMatrix(true, true);
        const bounds = new Box3().setFromObject(gltf.scene);
        const height = bounds.max.y - bounds.min.y;
        const normalizer = new Matrix4()
          .makeScale(1 / height, 1 / height, 1 / height)
          .multiply(
            new Matrix4().makeTranslation(
              -(bounds.min.x + bounds.max.x) / 2,
              -bounds.min.y,
              -(bounds.min.z + bounds.max.z) / 2,
            ),
          );
        const parts: TreePart[] = [];
        gltf.scene.traverse((node) => {
          if (!(node as Mesh).isMesh) return;
          const mesh = node as Mesh;
          const geometry = mesh.geometry.clone();
          geometry.applyMatrix4(normalizer.clone().multiply(mesh.matrixWorld));
          const loadedMaterial = (
            Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
          ) as MeshStandardMaterial;
          const materialName = loadedMaterial.name.toLowerCase();
          const color = materialName.includes('folha')
            ? '#6f9f6c'
            : materialName.includes('tronco')
              ? '#7a5a45'
              : loadedMaterial.color;
          const material = new MeshStandardMaterial({
            color,
            vertexColors: geometry.hasAttribute('color'),
            roughness: loadedMaterial.roughness,
            metalness: loadedMaterial.metalness,
            side: loadedMaterial.side,
          });
          parts.push({ geometry, material });
        });
        if (!parts.length) throw new Error(`${TREE_URLS[kind]} contains no meshes`);
        return { kind, parts };
      }),
    );
    if (this.disposed) {
      for (const result of loaded)
        if (result.status === 'fulfilled')
          for (const part of result.value.parts) {
            part.geometry.dispose();
            part.material.dispose();
          }
      return;
    }
    const loadedKinds = new Set(
      loaded.flatMap((result) => (result.status === 'fulfilled' ? [result.value.kind] : [])),
    );
    const placements = this.treePlacements.filter((placement) => loadedKinds.has(placement.kind));
    const planters = this.tint(
      this.resources.cube,
      this.resources.material('#f3f2ed'),
      placements.length,
    );
    const soil = this.tint(
      this.resources.cube,
      this.resources.material('#453b30'),
      placements.length,
    );
    planters.mesh.name = 'tree-planters';
    for (const placement of placements) {
      planters.add(
        this.matrix([placement.x, SIDEWALK_HEIGHT + 0.14, placement.z, 0.5, 0.28, 0.5]),
        this.scratch.set('#ffffff'),
        placement.key,
      );
      soil.add(
        this.matrix([placement.x, SIDEWALK_HEIGHT + 0.282, placement.z, 0.36, 0.015, 0.36]),
        this.scratch.set('#ffffff'),
        placement.key,
      );
    }
    for (const result of loaded) {
      if (result.status === 'rejected') {
        console.warn('City: a tree model could not load', result.reason);
        continue;
      }
      const { kind, parts } = result.value;
      const placements = this.treePlacements.filter((placement) => placement.kind === kind);
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex];
        this.treeParts.push(part);
        const batch = this.tint(part.geometry, part.material, placements.length);
        batch.mesh.name = `${kind}-trees-${partIndex}`;
        for (const placement of placements) {
          this.dummy.position.set(placement.x, SIDEWALK_HEIGHT + 0.29, placement.z);
          this.dummy.rotation.set(0, placement.rotation, 0);
          this.dummy.scale.setScalar(placement.height);
          this.dummy.updateMatrix();
          this.treeMatrix.copy(this.dummy.matrix);
          batch.add(this.treeMatrix, this.scratch.set('#ffffff'), placement.key);
        }
      }
    }
  }

  /** Grays lots, parks, and trees outside the focused block. */
  applyEmphasis(emphasisForKey: (key: number) => number) {
    this.tinted.forEach((batch) => batch.applyEmphasis(emphasisForKey));
  }
  setNight(value: number) {
    this.lampHeads.emissiveIntensity = 0.25 + value * 3.4;
    this.litWindows.emissiveIntensity = 0.05 + value * 1.45;
    this.poolStrength.value = value * 0.55;
  }
  dispose() {
    this.disposed = true;
    this.meshes.forEach((mesh) => mesh.dispose());
    this.tinted.forEach((batch) => batch.dispose());
    for (const parts of [this.treeParts, this.propParts])
      parts.forEach(({ geometry, material }) => {
        geometry.dispose();
        material.dispose();
      });
    this.plane.dispose();
    this.lampHeads.dispose();
    this.litWindows.dispose();
    this.poolMaterial.dispose();
    this.backdrop.dispose();
    this.resources.dispose();
  }
}
