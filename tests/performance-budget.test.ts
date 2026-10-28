import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { InstancedMesh, Matrix4, Mesh, Vector3 } from 'three/webgpu';
import { AdaptiveResolution, renderPixelRatio } from '../src/experience/core/RenderQuality';
import { City } from '../src/experience/world/City';
import {
  BLOCK_PITCH,
  CITY_BLOCKS,
  LAMP_OFFSETS,
  LOT_SIZE,
  isParkBlock,
} from '../src/experience/world/layout';

if (!globalThis.ProgressEvent)
  Object.defineProperty(globalThis, 'ProgressEvent', {
    value: class extends Event {
      constructor(type: string, init: Record<string, unknown>) {
        super(type);
        Object.assign(this, init);
      }
    },
    configurable: true,
  });

test('the compact backdrop stays within its geometry budget and keeps real house silhouettes', () => {
  const city = new City();
  assert.ok((CITY_BLOCKS * 2 + 1) ** 2 <= 81);
  const houses = city.root.getObjectByName('filler-bodies') as InstancedMesh;
  // 81 blocks less the 21 the locked camera can never frame, less the nine central districts.
  assert.equal(houses.count, 51);
  assert.equal(houses.castShadow, false);
  // Lamp posts are too slender to read in the shadow map and stay out of both shadow passes.
  const posts = city.root.getObjectByName('lamp-posts') as InstancedMesh;
  assert.equal(posts.castShadow, false);
  let instances = 0,
    triangles = 0;
  city.root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const count = object instanceof InstancedMesh ? object.count : 1;
    instances += count;
    triangles +=
      ((object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3) * count;
  });
  assert.ok(instances < 2000, `background instances: ${instances}`);
  assert.ok(triangles < 28000, `background triangles: ${triangles}`);
  // Sidewalk footprints stay square when switching to cheap box geometry.
  const lots = city.root.getObjectByName('sidewalk-lots') as InstancedMesh;
  assert.equal(lots.count, 60, 'one lot per block the camera can reach');
  const matrix = new Matrix4();
  lots.getMatrixAt(0, matrix);
  const scale = new Vector3().setFromMatrixScale(matrix);
  assert.ok(Math.abs(scale.x - LOT_SIZE) < 1e-5 && Math.abs(scale.z - LOT_SIZE) < 1e-5);
  city.dispose();
});

test('three authored tree GLBs replace every procedural tree with instanced meshes', async () => {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const pathname = new URL(url).pathname;
    if (!pathname.startsWith('/models/')) return nativeFetch(input);
    return new Response(readFileSync(`public${pathname}`), {
      headers: { 'content-type': 'model/gltf-binary' },
    });
  }) as typeof fetch;
  const city = new City();
  try {
    await city.loadTrees('http://token-town.test');
    const pine = city.root.getObjectByName('pine-trees-0') as InstancedMesh;
    const broadleafCrown = city.root.getObjectByName('broadleaf-trees-0') as InstancedMesh;
    const broadleafTrunk = city.root.getObjectByName('broadleaf-trees-1') as InstancedMesh;
    const quaternius = city.root.getObjectByName('quaternius-trees-0') as InstancedMesh;
    // 21 beside the districts, five on the plaza rim and five in each park.
    assert.equal(pine.count, 11);
    for (const mesh of [broadleafCrown, broadleafTrunk, quaternius]) assert.equal(mesh.count, 10);
    const planters = city.root.getObjectByName('tree-planters') as InstancedMesh;
    assert.equal(planters.count, 31);
    const buildingSides = new Map<string, number[]>();
    const matrix = new Matrix4();
    const position = new Vector3();
    for (let index = 0; index < planters.count; index++) {
      planters.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      const i = Math.round(position.x / BLOCK_PITCH);
      const j = Math.round(position.z / BLOCK_PITCH);
      if (isParkBlock(i, j)) continue;
      const key = `${i},${j}`;
      const sides = buildingSides.get(key) ?? [0, 0];
      sides[position.x < i * BLOCK_PITCH ? 0 : 1]++;
      buildingSides.set(key, sides);
    }
    assert.equal(buildingSides.size, 7);
    for (const sides of buildingSides.values()) assert.deepEqual(sides, [1, 2]);
    assert.equal(LAMP_OFFSETS.length, 4);
    assert.ok(
      LAMP_OFFSETS.every(([, z]) => z >= 0),
      'rear corner lamps are removed',
    );
    const treeTriangles = [pine, broadleafCrown, broadleafTrunk, quaternius].reduce(
      (total, mesh) =>
        total +
        ((mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3) * mesh.count,
      0,
    );
    assert.ok(treeTriangles < 20_000, `tree triangles: ${treeTriangles}`);
  } finally {
    city.dispose();
    globalThis.fetch = nativeFetch;
  }
});

test('GPU resolution respects viewport, native density and pixel budgets', () => {
  assert.equal(renderPixelRatio(3, 390, 600), 1.25);
  assert.equal(renderPixelRatio(0.5, 1440, 700), 0.5, 'do not upscale low-density displays');
  for (const [width, height] of [
    [1440, 700],
    [3840, 2160],
    [390, 600],
    [320, 680],
  ]) {
    const ratio = renderPixelRatio(3, width, height);
    assert.ok(width * height * ratio * ratio <= 1_500_001);
    assert.ok(renderPixelRatio(3, width, height, 0.65) < ratio);
  }
});

test('adaptive resolution responds to sustained slow frames, ignores stalls, and recovers without oscillation', () => {
  const quality = new AdaptiveResolution();
  for (let i = 0; i < 89; i++) assert.equal(quality.sample(1 / 30), false);
  assert.equal(quality.sample(1 / 30), true);
  assert.equal(quality.scale, 0.85);
  for (let i = 0; i < 500; i++) quality.sample(1 / 20);
  assert.equal(quality.scale, 0.65);
  quality.reset();
  for (let i = 0; i < 100; i++) quality.sample(2);
  assert.equal(quality.scale, 0.65, 'hidden-tab or compilation gaps cannot change quality');
  for (let i = 0; i < 269; i++) quality.sample(1 / 60);
  assert.equal(quality.scale, 0.65, 'recovery needs sustained headroom');
  quality.sample(1 / 60);
  assert.equal(quality.scale, 0.75);
  for (let i = 0; i < 1000; i++) quality.sample(1 / 60);
  assert.equal(quality.scale, 1);
});
