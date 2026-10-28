import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Frustum, InstancedMesh, Matrix4, Sphere, Spherical, Vector3 } from 'three/webgpu';
import { models, stops } from '../src/data/models';
import { CameraRig, createShot, type Shot } from '../src/experience/camera/CameraRig';
import { PrimitiveFactoryAsset } from '../src/experience/loaders/PrimitiveFactoryAsset';
import { City } from '../src/experience/world/City';
import {
  BLOCK_PITCH,
  CITY_BLOCKS,
  FOG_FAR_OFFSET,
  LOT_HALF,
  isBlockInSight,
} from '../src/experience/world/layout';

Object.defineProperty(globalThis, 'matchMedia', {
  value: () => ({ matches: true }),
  configurable: true,
});

// The same stage sizes the locked-camera tests use.
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
/** Spare ground kept around every culled lot, so a framing tweak cannot expose bare ground. */
const MARGIN = 3;
/** Fog slack on top of that: a block only counts as hidden well beyond the opaque distance. */
const FOG_SLACK = 8;
/** Tallest filler silhouette plus its roof. */
const MAX_HEIGHT = 8;

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

/** Collects every block a pose can see: inside the frustum and not yet lost in the fog. */
function collectVisible(rig: CameraRig, into: Set<string>) {
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(rig.camera.projectionMatrix, rig.camera.matrixWorldInverse),
  );
  const forward = rig.camera.getWorldDirection(new Vector3());
  const corner = new Vector3();
  const box = new Box3();
  const fogFar = rig.distance + FOG_FAR_OFFSET + FOG_SLACK;
  for (let i = -CITY_BLOCKS; i <= CITY_BLOCKS; i++)
    for (let j = -CITY_BLOCKS; j <= CITY_BLOCKS; j++) {
      const reach = LOT_HALF + MARGIN;
      box.min.set(i * BLOCK_PITCH - reach, 0, j * BLOCK_PITCH - reach);
      box.max.set(i * BLOCK_PITCH + reach, MAX_HEIGHT, j * BLOCK_PITCH + reach);
      if (!frustum.intersectsBox(box)) continue;
      let nearest = Infinity;
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z])
            nearest = Math.min(nearest, corner.set(x, y, z).sub(rig.camera.position).dot(forward));
      if (nearest <= fogFar) into.add(`${i},${j}`);
    }
}

test('no locked shot, orbit or transition can reach a block the city leaves empty', () => {
  const { assets, shots } = buildShots();
  const canvas = { dataset: {} } as unknown as HTMLCanvasElement;
  const rig = new CameraRig(canvas);
  const visible = new Set<string>();
  for (const [width, height] of viewports) {
    rig.resize(width, height);
    shots.forEach((shot, index) => {
      rig.focus(shot, true);
      collectVisible(rig, visible);
      // Both ends of the drag-to-look range, which the rig clamps to a twelfth of a turn.
      for (const orbit of [-Math.PI / 12, Math.PI / 6]) {
        rig.orbitBy(orbit);
        collectVisible(rig, visible);
      }
      rig.focus(shot, true);
      const next: Shot = shots[(index + 1) % shots.length];
      const fromTarget = rig.target.clone();
      const from = new Spherical().setFromVector3(rig.camera.position.clone().sub(fromTarget));
      for (let progress = 0.1; progress < 1; progress += 0.1) {
        rig.poseBetween(fromTarget, from, next, progress);
        collectVisible(rig, visible);
      }
    });
  }
  for (const key of visible) {
    const [i, j] = key.split(',').map(Number);
    assert.ok(isBlockInSight(i, j), `the tour reaches block ${key}, which the city leaves empty`);
  }
  let culled = 0;
  for (let i = -CITY_BLOCKS; i <= CITY_BLOCKS; i++)
    for (let j = -CITY_BLOCKS; j <= CITY_BLOCKS; j++) if (!isBlockInSight(i, j)) culled++;
  // Guards the other direction: the backdrop must not quietly grow back to the full grid.
  assert.ok(culled >= 20, `only ${culled} blocks are culled`);
  assets.forEach((asset) => asset.dispose());
  rig.dispose();
});

test('the city builds nothing on a blind block', () => {
  const city = new City();
  city.root.updateMatrixWorld(true);
  const matrix = new Matrix4();
  const position = new Vector3();
  let checked = 0;
  city.root.traverse((object) => {
    if (!(object instanceof InstancedMesh) || !object.count) return;
    for (let index = 0; index < object.count; index++) {
      object.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      const i = Math.round(position.x / BLOCK_PITCH),
        j = Math.round(position.z / BLOCK_PITCH);
      // Road markings sit between lots and belong to the street grid, not to a block.
      if (
        Math.abs(position.x - i * BLOCK_PITCH) > LOT_HALF ||
        Math.abs(position.z - j * BLOCK_PITCH) > LOT_HALF
      )
        continue;
      assert.ok(
        isBlockInSight(i, j),
        `${object.name || 'instances'}[${index}] sits on blind block ${i},${j}`,
      );
      checked++;
    }
  });
  assert.ok(checked > 800, `only ${checked} instances checked`);
  city.dispose();
});
