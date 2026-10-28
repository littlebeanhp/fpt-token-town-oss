import {
  Box3,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Object3D,
  PointLight,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AnchorName, StopDefinition } from '@/types/factory';
import { AssetBase } from './AssetBase';

/**
 * Districts share houses, and fetching and parsing the same GLB twice buys nothing: the file is
 * read once and every district clones the result, so geometry and textures are uploaded once.
 * Each clone still gets its own materials, because the loader retints and relights every surface.
 * The template is released when the last district using it is disposed.
 */
interface HouseTemplate {
  scene: Promise<Group>;
  users: number;
}
const templates = new Map<string, HouseTemplate>();

/**
 * Starts fetching and parsing the houses without taking a reference to any of them, so the
 * five district files download side by side while the first view is still being built.
 */
export function preloadHouses(urls: Iterable<string>) {
  for (const url of urls) {
    if (templates.has(url)) continue;
    const template: HouseTemplate = {
      scene: new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene),
      users: 0,
    };
    templates.set(url, template);
    // A prefetch nobody claimed must not leave a rejected promise behind for the real load.
    template.scene.catch(() => {
      if (template.users <= 0 && templates.get(url) === template) templates.delete(url);
    });
  }
}

async function cloneHouse(url: string) {
  let template = templates.get(url);
  if (!template) {
    template = { scene: new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene), users: 0 };
    templates.set(url, template);
  }
  const held = template;
  held.users++;
  let scene: Group;
  try {
    scene = await held.scene;
  } catch (error) {
    // A failed fetch must not leave a poisoned entry behind for the next district or a retry.
    held.users--;
    if (held.users <= 0) templates.delete(url);
    throw error;
  }
  const release = () => {
    if (--held.users > 0 || templates.get(url) !== held) return;
    templates.delete(url);
    const textures = new Set<Texture>();
    scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material))
          if (value instanceof Texture) textures.add(value);
        material.dispose();
      }
    });
    textures.forEach((texture) => texture.dispose());
  };
  return { root: scene.clone(true) as Group, release };
}

const ANCHOR_NAMES: AnchorName[] = [
  'CameraAnchor',
  'CameraTarget',
  'TokenInput',
  'TokenOutput',
  'UIAnchor',
];
/** Footprint the authored houses are scaled into, matching the primitive districts they replace. */
const DISTRICT_WIDTH = 5.6;

/** Warm interior spill behind every window and doorway. */
const DOORWAY_GLOW = '#ffd49a';
/** Reach of the light thrown out of the doorway onto the plaza and the queue. */
const DOORWAY_LIGHT_RANGE = 7;
/** Panes whose centre sits below this share of the house are shopfront glass, not upper windows. */
const GROUND_FLOOR = 0.3;
/** Low panes further apart than this belong to separate openings. */
const DOOR_GAP = 0.45;
/**
 * Houses whose entrance the pane heuristic cannot see, because their door is solid rather than
 * glazed and only the shopfront glass is left to find. The correction is a share of the fitted
 * frontage, applied to the opening the panes did pick: house 01 is a market front whose door
 * sits a fifth of the frontage to the left of its window, and the two Gemma districts share it,
 * so without this their visitors walk into the counter.
 */
const DOORWAY_CORRECTION: Record<string, number> = {};

/**
 * The entrance is the ground-floor opening whose glass reaches closest to the pavement: a door
 * starts at the step, a shop window starts at waist height. Low front-facing panes are grouped
 * into openings by their horizontal gaps and the lowest group wins, so the queue walks into the
 * lit doorway instead of the middle of the wall.
 */
function pickDoorway(panes: Vector3[], fallback: Vector3) {
  if (!panes.length) return fallback;
  const sorted = [...panes].sort((first, second) => first.x - second.x);
  let best: { x: number; y: number; z: number; panes: number } | undefined;
  let group: Vector3[] = [];
  const close = () => {
    if (!group.length) return;
    const opening = {
      x: group.reduce((sum, pane) => sum + pane.x, 0) / group.length,
      y: Math.min(...group.map((pane) => pane.y)),
      z: Math.max(...group.map((pane) => pane.z)),
      panes: group.length,
    };
    // A clearly lower opening wins outright; between openings that start at the same height the
    // wider one is the way in.
    if (
      !best ||
      opening.y < best.y - 0.05 ||
      (opening.y < best.y + 0.05 && opening.panes > best.panes)
    )
      best = opening;
  };
  for (const pane of sorted) {
    if (group.length && pane.x - group[group.length - 1].x >= DOOR_GAP) {
      close();
      group = [];
    }
    group.push(pane);
  }
  close();
  return new Vector3(best!.x, best!.y, best!.z);
}

/**
 * A translucent nameplate over the shopfront carrying the vendor's mark and the model's name. The
 * houses keep the asset pack's own palette, so the sign is what tells the districts apart.
 */
function createSign(model: StopDefinition, width: number) {
  if (typeof document === 'undefined') return undefined;
  const scale = 96;
  // Hairlines and insets were tuned against a 1024px plate, so they follow the plate's size.
  const px = scale / 128;
  const canvas = document.createElement('canvas');
  canvas.width = 8 * scale;
  canvas.height = 2 * scale;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const markBox = scale * 1.05;
  const markLeft = scale * 0.45;
  const textLeft = markLeft + markBox + scale * 0.42;
  const markSize = { width: 1, height: 1 };
  const paint = (mark?: CanvasImageSource) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const glass = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    glass.addColorStop(0, 'rgba(222,237,246,0.42)');
    glass.addColorStop(0.45, 'rgba(31,44,62,0.78)');
    glass.addColorStop(1, 'rgba(15,26,43,0.88)');
    context.fillStyle = glass;
    context.beginPath();
    context.roundRect(4 * px, 4 * px, canvas.width - 8 * px, canvas.height - 8 * px, 34 * px);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.7)';
    context.lineWidth = 3 * px;
    context.stroke();
    context.fillStyle = model.color;
    context.fillRect(70 * px, canvas.height - 26 * px, canvas.width - 140 * px, 4 * px);
    // The vendor mark sits in its own lit panel, with a hairline separating it from the name.
    if (mark) {
      context.save();
      context.fillStyle = 'rgba(255,255,255,0.1)';
      context.beginPath();
      context.roundRect(
        markLeft - 14 * px,
        (canvas.height - markBox) / 2 - 14 * px,
        markBox + 28 * px,
        markBox + 28 * px,
        26 * px,
      );
      context.fill();
      context.shadowColor = 'rgba(8,16,30,0.55)';
      context.shadowBlur = scale * 0.1;
      // Marks are not all square: fit each one inside the panel instead of stretching it.
      const ratio = markSize.width / markSize.height;
      const drawWidth = ratio >= 1 ? markBox : markBox * ratio;
      const drawHeight = ratio >= 1 ? markBox / ratio : markBox;
      context.drawImage(
        mark,
        markLeft + (markBox - drawWidth) / 2,
        (canvas.height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      context.restore();
      context.fillStyle = 'rgba(255,255,255,0.28)';
      context.fillRect(textLeft - scale * 0.22, canvas.height * 0.28, 2 * px, canvas.height * 0.44);
    }
    // Model names vary a lot in length, so shrink to fit rather than letting a long one run off
    // the end of the board.
    const label = model.name.toUpperCase();
    const left = mark ? textLeft : scale * 0.6;
    const available = canvas.width - left - scale * 0.6;
    let size = scale * 0.92;
    const fontAt = (value: number) => `600 ${value}px "DM Sans", "Manrope", system-ui, sans-serif`;
    context.font = fontAt(size);
    const measured = context.measureText(label).width;
    if (measured > available) {
      size = Math.max(scale * 0.34, size * (available / measured));
      context.font = fontAt(size);
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = model.color;
    context.shadowBlur = scale * 0.06;
    context.fillStyle = '#ffffff';
    context.fillText(label, left + available / 2, canvas.height / 2 - 4 * px);
  };
  paint();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  // The mark is an SVG fetched separately: the plate is readable immediately and gains the logo
  // as soon as it decodes, so a slow or missing logo never holds up the city.
  const mark = new Image();
  mark.decoding = 'async';
  mark.src = `/logos/${model.logo}-mono.svg`;
  void mark
    .decode()
    .then(() => {
      markSize.width = mark.naturalWidth || 1;
      markSize.height = mark.naturalHeight || 1;
      paint(mark);
      texture.needsUpdate = true;
    })
    .catch(() => {});
  const board = new Mesh(
    new PlaneGeometry(width * 0.74, width * 0.74 * 0.25),
    new MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: new Color('#ffffff'),
      emissiveIntensity: 0.32,
      transparent: true,
      depthWrite: false,
      roughness: 0.18,
      metalness: 0,
    }),
  );
  board.name = 'GlassSign';
  board.castShadow = false;
  board.receiveShadow = false;
  return board;
}
const MAX_HEIGHT = 5.1;

export class GLTFFactoryAsset extends AssetBase {
  private doorway?: PointLight;

  private constructor(
    root: Group,
    model: StopDefinition,
    doorway?: PointLight,
    private release?: () => void,
  ) {
    super(root);
    this.doorway = doorway;
    this.prepare();
    root.position.set(...model.position);
  }

  /** The doorway reads as a real opening only if it also throws light onto the plaza. */
  setNight(value: number) {
    super.setNight(value);
    if (this.doorway) this.doorway.intensity = (0.25 + value * 6.5) * this.emphasis;
  }

  setEmphasis(value: number) {
    super.setEmphasis(value);
    this.setNight(this.night);
  }

  static async load(model: StopDefinition & { assetUrl?: string }) {
    if (!model.assetUrl) throw new Error('A GLB URL is required.');
    const { root, release } = await cloneHouse(model.assetUrl);

    // A GLB that declares its own anchors was authored against this city's scale, so leave it
    // exactly as exported. Raw asset-pack meshes carry none, and those get fitted to the lot.
    const authored = ANCHOR_NAMES.some((name) => root.getObjectByName(name));
    if (authored) {
      root.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        node.castShadow = true;
        node.receiveShadow = true;
      });
      return new GLTFFactoryAsset(root, model, undefined, release);
    }

    // The pack authors each house at its own scale, so fit the frontage first and let height
    // follow, clamped so the skyline across the six districts stays even.
    root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(root);
    const size = bounds.getSize(new Vector3());
    const fit = DISTRICT_WIDTH / Math.max(size.x, 1e-3);
    const scale = Math.min(fit, 4.3 / Math.max(size.z, 1e-3), MAX_HEIGHT / Math.max(size.y, 1e-3));
    root.scale.setScalar(scale);
    // Sit the house on the pavement and centre it on its lot.
    root.updateMatrixWorld(true);
    const placed = new Box3().setFromObject(root);
    const centre = placed.getCenter(new Vector3());
    root.position.set(-centre.x, 0.14 - placed.min.y, -centre.z);

    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const loaded = (
        Array.isArray(node.material) ? node.material[0] : node.material
      ) as MeshStandardMaterial;
      const role = loaded.name.replace(/\.\d+$/, '');
      const lit = role === 'windows' || role === 'lit';
      node.material = new MeshStandardMaterial({
        color: loaded.color,
        map: loaded.map,
        normalMap: loaded.normalMap,
        roughnessMap: loaded.roughnessMap,
        metalnessMap: loaded.metalnessMap,
        vertexColors: node.geometry.hasAttribute('color'),
        emissive: new Color(lit ? DOORWAY_GLOW : '#000000'),
        emissiveIntensity: lit ? 1.45 : 0,
        roughness: lit ? 0.28 : role === 'metal' ? 0.48 : 0.86,
        metalness: role === 'metal' ? 0.38 : 0,
      });
      node.material.name = role;
      node.castShadow = !lit;
      loaded?.dispose?.();
    });

    // AssetBase reads the bounding box for its anchors, so wrap the positioned house in a group
    // whose own origin is the lot centre.
    const holder = new Group();
    holder.add(root);

    root.updateMatrixWorld(true);
    const final = new Box3().setFromObject(root);
    const front = final.max.z;
    const height = final.max.y - final.min.y;
    const width = final.max.x - final.min.x;

    // Pick actual front-facing lit glass, so spill lights originate at windows, and keep the low
    // panes aside: those are the shopfront, and one of them is the way in.
    const candidates: Vector3[] = [];
    const lowPanes: Vector3[] = [];
    const a = new Vector3(),
      b = new Vector3(),
      c = new Vector3();
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      // `unlit_windows` is the frontage glass the window bake left dark. It is still a way in,
      // and two of the six houses keep their actual door there, so the entrance search reads
      // both: whichever opening is found becomes the lit one, because the lamp follows it.
      const role = (node.material as MeshStandardMaterial).name;
      if (role !== 'windows' && role !== 'unlit_windows') return;
      const geometry = node.geometry,
        positions = geometry.attributes.position,
        indices = geometry.index;
      for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
        a.fromBufferAttribute(positions, indices ? indices.getX(i) : i).applyMatrix4(
          node.matrixWorld,
        );
        b.fromBufferAttribute(positions, indices ? indices.getX(i + 1) : i + 1).applyMatrix4(
          node.matrixWorld,
        );
        c.fromBufferAttribute(positions, indices ? indices.getX(i + 2) : i + 2).applyMatrix4(
          node.matrixWorld,
        );
        const center = a
          .clone()
          .add(b)
          .add(c)
          .multiplyScalar(1 / 3);
        const normal = b.sub(a).cross(c.sub(a)).normalize();
        if (normal.z <= 0.8) continue;
        if (center.y <= height * GROUND_FLOOR) lowPanes.push(center);
        else if (role === 'windows') candidates.push(center);
      }
    });
    for (let side = 0; side < 2; side++) {
      const target = new Vector3((side ? 1 : -1) * width * 0.22, height * 0.64, front);
      const point = candidates.reduce(
        (best, point) =>
          point.distanceToSquared(target) < best.distanceToSquared(target) ? point : best,
        candidates[0] ?? target,
      );
      const anchor = new Object3D();
      anchor.name = `WindowSpill${side}`;
      anchor.position.copy(point).add(new Vector3(0, 0, 0.14));
      holder.add(anchor);
    }

    const cameraTarget = new Object3D();
    cameraTarget.name = 'CameraTarget';
    cameraTarget.position.set(0, height * 0.5, 0);
    holder.add(cameraTarget);

    // Visitors queue for this point and walk through it, so it has to be the real opening.
    const door = pickDoorway(lowPanes, new Vector3(0, final.min.y + 0.9, front));
    door.x += (DOORWAY_CORRECTION[model.assetUrl ?? ''] ?? 0) * width;
    const entrance = new Object3D();
    entrance.name = 'Doorway';
    entrance.position.copy(door);
    holder.add(entrance);
    const sign = createSign(model, width);
    if (sign) {
      sign.position.set(0, final.min.y + height * 0.39, front + 0.06);
      holder.add(sign);
    }

    // A real light, not just an emissive surface: it has to spill onto the pavement and the
    // queue so the entrance reads as somewhere people walk in and out of.
    const doorway = new PointLight(DOORWAY_GLOW, 0.35, DOORWAY_LIGHT_RANGE, 1.6);
    doorway.name = 'DoorwayLight';
    doorway.position.set(door.x, Math.max(door.y + 0.6, final.min.y + 0.8), door.z + 0.12);
    holder.add(doorway);

    return new GLTFFactoryAsset(holder, model, doorway, release);
  }

  /** Geometry and textures belong to the shared template; only this house's own copies go here. */
  dispose() {
    const textures = new Set<Texture>();
    this.root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        // Canvas nameplates are built per house, so their texture is this house's to free.
        if (node.name === 'GlassSign')
          for (const value of Object.values(material))
            if (value instanceof Texture) textures.add(value);
        material.dispose();
      }
    });
    this.root.traverse((node) => {
      if (node.name === 'GlassSign' && node instanceof Mesh) node.geometry.dispose();
    });
    textures.forEach((texture) => texture.dispose());
    this.release?.();
    this.release = undefined;
  }
}
