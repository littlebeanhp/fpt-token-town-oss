import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Plane, Raycaster, Sphere, Spherical, Vector2, Vector3 } from 'three/webgpu';
import { hubStop, models, stops } from '../src/data/models';
import { CameraRig, createShot, type Shot } from '../src/experience/camera/CameraRig';
import { PrimitiveFactoryAsset } from '../src/experience/loaders/PrimitiveFactoryAsset';
import { City } from '../src/experience/world/City';
import {
  BLOCK_PITCH,
  CITY_EXTENT,
  FOG_FAR_OFFSET,
  blockIndex,
  isDistrictBlock,
} from '../src/experience/world/layout';

Object.defineProperty(globalThis, 'matchMedia', {
  value: () => ({ matches: true }),
  configurable: true,
});

// Desktop, wide, short, tablet, small laptop, and both mobile stage sizes.
const viewports: [number, number][] = [
  [1440, 700],
  [1920, 950],
  [1280, 520],
  [1024, 700],
  [800, 600],
  [390, 600],
  [390, 385],
  [320, 680],
  [2560, 1080],
];
const ground = new Plane(new Vector3(0, 1, 0), 0);
/** Everything a shot sees must land this far inside the built-up city. */
const EDGE_MARGIN = 2;

function buildShots() {
  const assets = models.map((model) => new PrimitiveFactoryAsset(model));
  const shots = assets.map((asset, index) => {
    asset.root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(asset.root).getBoundingSphere(new Sphere());
    return createShot(
      stops[index].position,
      asset.getAnchor('CameraTarget', new Vector3()).y,
      bounds.radius,
    );
  });
  return { assets, shots };
}

function assertInsideCity(rig: CameraRig, label: string) {
  const raycaster = new Raycaster();
  const hit = new Vector3();
  for (let x = -1; x <= 1; x += 0.5)
    for (let y = -1; y <= 1; y += 0.5) {
      raycaster.setFromCamera(new Vector2(x, y), rig.camera);
      const direction = raycaster.ray.direction;
      assert.ok(direction.y < -0.05, `${label}: screen (${x}, ${y}) sees the sky`);
      assert.ok(raycaster.ray.intersectPlane(ground, hit), `${label}: ray misses the ground`);
      const reach = Math.max(Math.abs(hit.x), Math.abs(hit.z));
      const viewDepth = hit
        .clone()
        .sub(rig.camera.position)
        .dot(rig.camera.getWorldDirection(new Vector3()));
      assert.ok(
        reach < CITY_EXTENT - EDGE_MARGIN || viewDepth >= rig.distance + FOG_FAR_OFFSET,
        `${label}: screen (${x}, ${y}) reaches ${reach.toFixed(1)}, past the city`,
      );
    }
}

test('the tour starts at the hub and every district owns a central block', () => {
  assert.equal(stops[0].id, hubStop.id);
  const blocks = new Set<string>();
  for (const stop of stops) {
    const i = blockIndex(stop.position[0]),
      j = blockIndex(stop.position[2]);
    assert.ok(isDistrictBlock(i, j), `${stop.id} is in the district grid`);
    blocks.add(`${i},${j}`);
  }
  assert.equal(blocks.size, stops.length, 'no two stops share a block');
});

test('every locked shot and transition keeps the compact city edge outside the view or fully fogged', () => {
  const { assets, shots } = buildShots();
  const canvas = { dataset: {} } as unknown as HTMLCanvasElement;
  const rig = new CameraRig(canvas);
  for (const [width, height] of viewports) {
    rig.resize(width, height);
    shots.forEach((shot, index) => {
      rig.focus(shot, true);
      assertInsideCity(rig, `${stops[index].id} at ${width}x${height}`);
      // Sample the path to the next stop, including the wrap from the last back to the hub.
      const next: Shot = shots[(index + 1) % shots.length];
      const fromTarget = rig.target.clone();
      const from = new Spherical().setFromVector3(rig.camera.position.clone().sub(fromTarget));
      for (const progress of [0.2, 0.4, 0.5, 0.6, 0.8]) {
        rig.poseBetween(fromTarget, from, next, progress);
        assertInsideCity(rig, `${stops[index].id} -> next at ${progress}, ${width}x${height}`);
      }
    });
  }
  assets.forEach((asset) => asset.dispose());
  rig.dispose();
});

test('foreground blocks never hide the focused district', () => {
  const { assets, shots } = buildShots();
  const city = new City();
  city.root.updateMatrixWorld(true);
  const canvas = { dataset: {} } as unknown as HTMLCanvasElement;
  const rig = new CameraRig(canvas);
  const raycaster = new Raycaster();
  const filler = city.root.children.filter((child) => child.name.startsWith('filler'));
  assert.equal(filler.length, 2);
  for (const [width, height] of [
    [1440, 700],
    [390, 385],
    [320, 680],
    [2560, 1080],
  ] as const) {
    rig.resize(width, height);
    shots.forEach((shot, index) => {
      rig.focus(shot, true);
      const [x, , z] = stops[index].position;
      const centerZ = blockIndex(z) * BLOCK_PITCH;
      // Filler buildings and the other districts are the only things tall enough to block.
      const candidates = [
        ...filler,
        ...assets.filter((_, other) => other !== index).map((a) => a.root),
      ];
      // The building's base and the front of its visitor plaza must both be in sight.
      for (const point of [
        new Vector3(x, 0.6, z + 2),
        new Vector3(x - 2, 0.3, centerZ + 3),
        new Vector3(x + 2, 0.3, centerZ + 3),
      ]) {
        const toPoint = point.clone().sub(rig.camera.position);
        const distance = toPoint.length();
        raycaster.set(rig.camera.position, toPoint.normalize());
        raycaster.far = distance - 0.3;
        const blockers = raycaster.intersectObjects(candidates, true);
        assert.equal(
          blockers.length,
          0,
          `${stops[index].id} at ${width}x${height}: city geometry hides ${point.toArray()}`,
        );
      }
    });
  }
  city.dispose();
  assets.forEach((asset) => asset.dispose());
  rig.dispose();
});
