import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Vector3 } from 'three/webgpu';
import { crowdLoad, models, townHost } from '../src/data/models';
import { PrimitiveFactoryAsset } from '../src/experience/loaders/PrimitiveFactoryAsset';
import { City } from '../src/experience/world/City';
import { Crowd, HOST_SPOT, pickCharacter } from '../src/experience/world/Crowd';
import {
  createQueueLayout,
  sampleQueue,
  type QueuePoint,
} from '../src/experience/world/QueueLayout';
import { BLOCK_PITCH, LOT_HALF, blockIndex } from '../src/experience/world/layout';

/** Half a metre of elbow room: enough that the guide never clips a rope, a planter or a runner. */
const CLEARANCE = 0.5;

function hostSite() {
  const model = models.find((item) => item.id === townHost.stop);
  assert.ok(model, 'the host stop is a real district');
  const asset = new PrimitiveFactoryAsset(model);
  const front = new Box3().setFromObject(asset.root).max.z;
  const door = asset.getAnchor('Doorway', new Vector3());
  asset.dispose();
  return {
    x: model.position[0],
    z: model.position[2],
    front,
    door: { x: door.x, z: door.z },
    load: crowdLoad(model.usage),
    color: model.color,
    host: true,
  };
}

function distanceToSegment(p: QueuePoint, a: QueuePoint, b: QueuePoint) {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const span = dx * dx + dz * dz;
  const t = span ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / span)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

test('the guide stands on the plaza, clear of the queue, the runners and the planting', () => {
  const site = hostSite();
  const layout = createQueueLayout(site);
  const lotX = blockIndex(site.x) * BLOCK_PITCH,
    lotZ = blockIndex(site.z) * BLOCK_PITCH;
  const host = { x: lotX + layout.side * HOST_SPOT.x, z: lotZ + HOST_SPOT.z };

  assert.ok(host.z > site.front + 0.3, 'the guide stands outside the house');
  assert.ok(
    Math.abs(host.x - lotX) < LOT_HALF - 0.4 && Math.abs(host.z - lotZ) < LOT_HALF - 0.4,
    'the guide stands on their own lot, not in the road',
  );
  for (const [a, b] of layout.rails)
    assert.ok(
      distanceToSegment(host, a, b) >= CLEARANCE,
      `the guide stands clear of the queue ropes (${distanceToSegment(host, a, b).toFixed(2)})`,
    );
  // The waiting line itself, sampled along its whole length.
  const pose = { x: 0, z: 0, heading: 0 };
  for (let distance = 0; distance <= layout.length; distance += 0.1) {
    sampleQueue(layout, distance, pose);
    assert.ok(
      Math.hypot(pose.x - host.x, pose.z - host.z) >= CLEARANCE,
      'no visitor walks through the guide',
    );
  }
  const tail = { x: 0, z: 0, heading: 0 };
  sampleQueue(layout, layout.length, tail);
  for (const lane of [0, 1, 2]) {
    const route = Crowd.prototype['createRunnerRoute'](site, layout, tail, lane);
    for (let index = 1; index < route.points.length; index++)
      assert.ok(
        distanceToSegment(host, route.points[index - 1], route.points[index]) >= CLEARANCE,
        `runner lane ${lane} does not run through the guide`,
      );
  }
});

test('the guide stands clear of the trees and street props on their block', () => {
  const site = hostSite();
  const layout = createQueueLayout(site);
  const lotX = blockIndex(site.x) * BLOCK_PITCH,
    lotZ = blockIndex(site.z) * BLOCK_PITCH;
  const host = { x: lotX + layout.side * HOST_SPOT.x, z: lotZ + HOST_SPOT.z };
  const city = new City();
  const dressing = [
    ...(city as unknown as { treePlacements: QueuePoint[] }).treePlacements,
    ...(city as unknown as { propPlacements: QueuePoint[] }).propPlacements,
  ];
  let onBlock = 0;
  for (const item of dressing) {
    if (blockIndex(item.x) * BLOCK_PITCH !== lotX || blockIndex(item.z) * BLOCK_PITCH !== lotZ)
      continue;
    onBlock++;
    assert.ok(
      Math.hypot(item.x - host.x, item.z - host.z) >= CLEARANCE,
      `the guide stands clear of the dressing at ${item.x.toFixed(2)}, ${item.z.toFixed(2)}`,
    );
  }
  assert.ok(onBlock > 4, `only ${onBlock} dressed items on the host block`);
  city.dispose();
});

test('the guide is the only person in town wearing the FPT livery', () => {
  const assets = { fpt: {}, grab: {} } as Parameters<typeof pickCharacter>[2];
  const flow = {} as Parameters<typeof pickCharacter>[0]['flow'];
  let fpt = 0;
  for (let roll = 0; roll < 1; roll += 0.005) {
    // Whatever the roll, the guide wears it and nobody else can draw it.
    assert.equal(
      pickCharacter({ host: true, walker: false, flow: undefined }, roll, assets),
      'fpt',
    );
    for (const other of [
      { host: undefined, walker: true, flow: undefined },
      { host: undefined, walker: false, flow },
      { host: undefined, walker: false, flow: undefined },
    ])
      if (pickCharacter(other, roll, assets) === 'fpt') fpt++;
  }
  assert.equal(fpt, 0, 'no one but the guide is drawn as the FPT character');
  // Without the file the guide keeps their brand-coloured voxel shirt rather than vanishing.
  assert.equal(pickCharacter({ host: true, walker: false, flow: undefined }, 0.5, {}), 'voxel');
});
