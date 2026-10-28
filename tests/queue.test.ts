import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Color, InstancedMesh, Vector3 } from 'three/webgpu';
import { crowdLoad, models, ranked } from '../src/data/models';
import { BACKGROUND_EMPHASIS } from '../src/experience/core/emphasis';
import { PrimitiveFactoryAsset } from '../src/experience/loaders/PrimitiveFactoryAsset';
import { Crowd } from '../src/experience/world/Crowd';
import { QueueBarriers } from '../src/experience/world/QueueBarriers';
import {
  INSIDE_CLEARANCE,
  MIN_QUEUE_SLOTS,
  QUEUE_ARRIVAL_DISTANCE,
  QUEUE_INSIDE_DISTANCE,
  QUEUE_SPACING,
  QUEUE_STEP_SECONDS,
  RUNNERS_PER_QUEUE,
  createQueueLayout,
  queueSlotCount,
  queueTrackIndex,
  runnerCount,
  sampleQueue,
  sampleQueueEntry,
  sampleQueueFlow,
  type QueueSite,
  type QueuePoint,
} from '../src/experience/world/QueueLayout';
import { BLOCK_PITCH, LOT_HALF, blockIndex } from '../src/experience/world/layout';

function sites(): QueueSite[] {
  return models.map((model) => {
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
    };
  });
}
function distanceToRail(p: QueuePoint, a: QueuePoint, b: QueuePoint) {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

test('every model shop has a queue with clear doorway, turns and sidewalk entrance', () => {
  for (const site of sites()) {
    const layout = createQueueLayout(site);
    const centerZ = blockIndex(site.z) * BLOCK_PITCH;
    assert.ok(layout.length / QUEUE_SPACING > 30, 'the waiting line has over 30 dense slots');
    const pose = { x: 0, z: 0, heading: 0 };
    for (let distance = 0; distance <= layout.length; distance += 0.025) {
      sampleQueue(layout, distance, pose);
      for (const [a, b] of layout.rails)
        assert.ok(
          distanceToRail(pose, a, b) >= 0.2,
          'people can follow the queue without walking through a rope or post',
        );
      assert.ok(Math.abs(pose.x - site.x) < LOT_HALF - 0.2);
      assert.ok(Math.abs(pose.z - centerZ) < LOT_HALF - 0.2);
      assert.ok(pose.z > site.front, 'queue stays outside the building');
    }
    const barriers = new QueueBarriers([site]);
    const bounds = new Box3().setFromObject(barriers.root);
    assert.ok(bounds.max.z < centerZ + LOT_HALF);
    assert.ok(bounds.min.z > site.front);
    assert.ok(bounds.min.x > site.x - LOT_HALF && bounds.max.x < site.x + LOT_HALF);
    barriers.dispose();
  }
});

test('all runner lanes leave through the doorway and open side without crossing barriers', () => {
  for (const site of sites()) {
    const layout = createQueueLayout(site);
    const tail = { x: 0, z: 0, heading: 0 };
    sampleQueue(layout, layout.length, tail);
    for (const lane of [0, 1, 2]) {
      const route = Crowd.prototype['createRunnerRoute'](site, layout, tail, lane);
      // Check the actual route from inside the house to the outside of the queue.
      for (let segment = 1; segment <= 2; segment++) {
        const a = route.points[segment - 1],
          b = route.points[segment];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.025);
        for (let step = 0; step <= steps; step++) {
          const p = {
            x: a.x + ((b.x - a.x) * step) / steps,
            z: a.z + ((b.z - a.z) * step) / steps,
          };
          for (const [railA, railB] of layout.rails)
            assert.ok(
              distanceToRail(p, railA, railB) >= 0.2,
              `runner lane ${lane} clears ropes and posts when leaving the house`,
            );
        }
      }
    }
  }
});

test('one person exchanges with a fixed runner every half-second', () => {
  const site = sites()[0],
    layout = createQueueLayout(site),
    slots = queueSlotCount(layout),
    runners = runnerCount(layout),
    total = slots + runners + 1,
    pose = { x: 0, z: 0, heading: 0 };
  assert.equal(runners, RUNNERS_PER_QUEUE, 'the busiest district runs the full circuit');
  sampleQueueFlow(layout, 0, pose);
  assert.ok(pose.x < layout.path.at(-1)!.x, 'a new visitor approaches the open line entrance');
  sampleQueueFlow(layout, QUEUE_ARRIVAL_DISTANCE + layout.length, pose);
  assert.ok(
    Math.abs(pose.x - layout.door.x) < 0.001,
    'the visitor leaving the line is lined up with the doorway',
  );
  sampleQueueFlow(
    layout,
    QUEUE_ARRIVAL_DISTANCE + layout.length + QUEUE_INSIDE_DISTANCE * 0.5,
    pose,
  );
  assert.ok(pose.z < site.front, 'the visitor continues inside the model building');
  assert.equal(queueTrackIndex(0, QUEUE_STEP_SECONDS - 0.001, slots), 0);
  assert.equal(
    queueTrackIndex(0, QUEUE_STEP_SECONDS, slots),
    total - 1,
    'the front person stays in the indoor slot before becoming a runner',
  );
  assert.equal(
    queueTrackIndex(slots, QUEUE_STEP_SECONDS, slots),
    slots - 1,
    'the oldest runner rejoins the back of the queue at the same event',
  );
  assert.equal(
    queueTrackIndex(0, 2 * QUEUE_STEP_SECONDS, slots),
    total - 2,
    'the prior indoor visitor exits only on the next exchange',
  );
  assert.notEqual(
    queueTrackIndex(1, 2 * QUEUE_STEP_SECONDS, slots),
    total - 2,
    'the new entrant is distinct from the exiting visitor',
  );
  for (const time of [0, 0.5, 1.25, 4.8]) {
    let running = 0;
    for (let person = 0; person < total; person++)
      if (
        queueTrackIndex(person, time, slots, runners) >= slots &&
        queueTrackIndex(person, time, slots, runners) < total - 1
      )
        running++;
    assert.equal(running, runners, 'runner count stays fixed around every building');
  }
  assert.equal(
    queueTrackIndex(3, total * QUEUE_STEP_SECONDS, slots, runners),
    3,
    'each person runs around and returns instead of disappearing',
  );
});

test('red ropes use instanced rendering and gray with the unfocused shops', () => {
  const allSites = sites();
  const barriers = new QueueBarriers(allSites);
  assert.equal(barriers.root.children.length, 4, 'four shared batches for all seven shops');
  const ropes = barriers.root.getObjectByName('queue-red-ropes') as InstancedMesh;
  const color = new Color();
  barriers.applyEmphasis(() => 1);
  for (let i = 0; i < ropes.count; i++) {
    ropes.getColorAt(i, color);
    assert.ok(color.r > color.g * 5, 'focused rope is red');
  }
  barriers.applyEmphasis(() => BACKGROUND_EMPHASIS);
  for (let i = 0; i < ropes.count; i++) {
    ropes.getColorAt(i, color);
    assert.equal(color.r, color.g);
    assert.equal(color.g, color.b);
  }
  let disposed = 0;
  for (const batch of barriers.root.children)
    (batch as InstancedMesh).addEventListener('dispose', () => disposed++);
  barriers.dispose();
  assert.equal(disposed, 4);
});

test('visitor numbers follow token burn, busiest first and nobody left standing alone', () => {
  const counts = new Map<string, number>();
  const all = sites();
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    // Real houses put their door anywhere along the frontage, which changes how long the first
    // row is. Walk the whole range so a wide frontage can never out-queue a busier district.
    const offsets = [-1.3, 1.72, -0.5, 1.09, 0, -0.88, 0.87];
    const site = {
      ...all[index],
      door: { x: all[index].x + offsets[index], z: all[index].front - 0.6 },
    };
    const layout = createQueueLayout(site);
    const slots = queueSlotCount(layout);
    const runners = runnerCount(layout);
    assert.ok(slots >= MIN_QUEUE_SLOTS, `${model.id}: the line never empties out`);
    counts.set(model.id, slots + runners + 1);
  }
  const busiest = counts.get(ranked[0].id)!;
  const quietest = counts.get(ranked.at(-1)!.id)!;
  assert.ok(busiest > quietest, 'the busiest district draws more visitors than the quietest');
  assert.ok(quietest / busiest < 0.75, 'and the difference is visible from the street');
  assert.ok(quietest / busiest > 0.3, 'without the quiet shop looking abandoned');
  for (let i = 1; i < ranked.length; i++)
    assert.ok(
      counts.get(ranked[i - 1].id)! >= counts.get(ranked[i].id)!,
      `${ranked[i - 1].id} burns more tokens than ${ranked[i].id}, so it is never the emptier shop`,
    );
});

test('the head of the line stands in the real doorway wherever it sits on the frontage', () => {
  const base = sites()[0];
  const centred = createQueueLayout({ ...base, door: { x: base.x, z: base.front } });
  for (const offset of [-1.72, -1.3, -1.01, -0.35, 0, 0.79, 1.01, 1.72]) {
    const site: QueueSite = { ...base, door: { x: base.x + offset, z: base.front - 0.7 } };
    const layout = createQueueLayout(site);
    const label = `door at ${offset}`;
    assert.ok(
      Math.abs(layout.path[0].x - site.door.x) < 0.001,
      `${label}: the line forms at the door, not the middle of the frontage`,
    );
    // Mirroring keeps the rows full length on either side, so the frontage never shortens a line.
    assert.ok(layout.length >= centred.length - 0.001, `${label}: the line is never cut short`);
    assert.equal(
      queueSlotCount(layout),
      queueSlotCount(centred),
      `${label}: only token burn changes how many people turn up`,
    );
    assert.ok(layout.length / QUEUE_SPACING > 30, `${label}: the line still holds a crowd`);
    const pose = { x: 0, z: 0, heading: 0 };
    sampleQueueEntry(layout, layout.inside, pose);
    assert.ok(Math.abs(pose.x - site.door.x) < 0.001, `${label}: the visitor walks into the door`);
    assert.ok(
      Math.abs(pose.z - (site.door.z - INSIDE_CLEARANCE)) < 0.001,
      `${label}: and ends a stride behind the glass`,
    );
    for (let distance = 0; distance <= layout.length; distance += 0.025) {
      sampleQueue(layout, distance, pose);
      for (const [a, b] of layout.rails)
        assert.ok(distanceToRail(pose, a, b) >= 0.2, `${label}: the line clears every rope`);
      assert.ok(Math.abs(pose.x - site.x) < LOT_HALF - 0.2, `${label}: it stays on the lot`);
      assert.ok(pose.z > site.front, `${label}: and outside the building`);
    }
    const tail = { x: 0, z: 0, heading: 0 };
    sampleQueue(layout, layout.length, tail);
    for (const lane of [0, 1, 2]) {
      const route = Crowd.prototype['createRunnerRoute'](site, layout, tail, lane);
      // Leavers come out of the same doorway, a touch towards the runners' side, and cut across
      // away from the straight line the queue walks in on.
      const shift = (route.points[0].x - site.door.x) * layout.side;
      assert.ok(
        shift > 0 && shift < 0.25,
        `${label}: runners come back out of the same doorway, off to the runners' side`,
      );
      assert.ok(
        (route.points[1].x - site.door.x) * layout.side > 0.5 &&
          route.points[1].z > route.points[0].z,
        `${label}: and cut diagonally clear of the incoming line`,
      );
      for (let segment = 1; segment <= 2; segment++) {
        const a = route.points[segment - 1],
          b = route.points[segment];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.025);
        for (let step = 0; step <= steps; step++) {
          const p = {
            x: a.x + ((b.x - a.x) * step) / steps,
            z: a.z + ((b.z - a.z) * step) / steps,
          };
          for (const [railA, railB] of layout.rails)
            assert.ok(
              distanceToRail(p, railA, railB) >= 0.2,
              `${label}: lane ${lane} clears ropes`,
            );
        }
      }
    }
  }
});
