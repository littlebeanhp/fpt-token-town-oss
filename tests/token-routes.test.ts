import assert from 'node:assert/strict';
import test from 'node:test';
import { models } from '../src/data/models';
import { tokenRoute, TOKEN_PLAZA } from '../src/experience/simulation/tokenRoutes';
import { BLOCK_PITCH, LOT_HALF, SIDEWALK_HEIGHT, blockIndex } from '../src/experience/world/layout';

test('every token lane connects the public square rim to a district rim and avoids building interiors', () => {
  for (const [index, model] of models.entries())
    for (const direction of [1, -1]) {
      const route = tokenRoute(model.position, index, direction);
      const start = route.getPoint(0),
        end = route.getPoint(1);
      assert.equal(start.z, TOKEN_PLAZA.z + LOT_HALF);
      assert.ok(Math.abs(start.x - TOKEN_PLAZA.x) < LOT_HALF);
      assert.equal(end.z, blockIndex(model.position[2]) * BLOCK_PITCH + LOT_HALF);
      assert.equal(end.y, SIDEWALK_HEIGHT + 0.05);
      assert.ok(start.distanceTo(end) > 1);
      for (let step = 0; step <= 1000; step++) {
        const point = route.getPointAt(step / 1000);
        for (const other of models) {
          const x = blockIndex(other.position[0]) * BLOCK_PITCH;
          const z = blockIndex(other.position[2]) * BLOCK_PITCH;
          assert.ok(
            Math.abs(point.x - x) >= LOT_HALF - 0.01 || Math.abs(point.z - z) >= LOT_HALF - 0.01,
            `${model.id} route entered ${other.id} lot`,
          );
        }
      }
    }
});
