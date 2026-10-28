import assert from 'node:assert/strict';
import test from 'node:test';
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three/webgpu';
import { BACKGROUND_EMPHASIS } from '../src/experience/core/emphasis';
import { PrimitiveVehicleAsset } from '../src/experience/loaders/PrimitiveVehicleAsset';
import { Traffic } from '../src/experience/world/Traffic';
import {
  BLOCK_PITCH,
  CITY_EXTENT,
  LOT_HALF,
  TRAFFIC_LANES,
  TRAFFIC_LOOP_LENGTH,
  blockKeyAt,
  sampleTrafficLane,
} from '../src/experience/world/layout';

const pose = () => ({ x: 0, z: 0, heading: 0 });
const mesh = (traffic: Traffic, name: string) =>
  traffic.root.getObjectByName(name) as InstancedMesh;
const matrixAt = (batch: InstancedMesh, index: number) => {
  const out = new Matrix4();
  batch.getMatrixAt(index, out);
  return out;
};

test('lanes close smoothly, follow their heading at constant speed, and keep vehicle footprints on roads', () => {
  const car = new PrimitiveVehicleAsset('car');
  const bike = new PrimitiveVehicleAsset('bike');
  const p = pose(),
    next = pose(),
    wrapped = pose();
  for (const lane of TRAFFIC_LANES) {
    for (let distance = 0; distance < TRAFFIC_LOOP_LENGTH; distance += 0.025) {
      sampleTrafficLane(lane, distance, p);
      sampleTrafficLane(lane, distance + 0.001, next);
      sampleTrafficLane(lane, distance - TRAFFIC_LOOP_LENGTH, wrapped);
      assert.ok(
        Math.hypot(p.x - wrapped.x, p.z - wrapped.z) < 1e-10,
        'negative trail samples wrap',
      );
      assert.ok(Math.abs(Math.hypot(next.x - p.x, next.z - p.z) - 0.001) < 1e-7);
      assert.ok(Math.abs((next.x - p.x) / 0.001 - Math.sin(p.heading)) < 0.002);
      assert.ok(Math.abs((next.z - p.z) / 0.001 - Math.cos(p.heading)) < 0.002);
      assert.equal(blockKeyAt(p.x, p.z), lane.key, 'focus ownership stays in the lane block');
      // Check the largest possible vehicle, including wheels, throughout every rounded turn.
      for (const asset of [car, bike])
        for (const part of asset.parts) {
          const positions = part.geometry.getAttribute('position');
          for (let v = 0; v < positions.count; v++) {
            const x =
              p.x +
              1.08 *
                (positions.getX(v) * Math.cos(p.heading) + positions.getZ(v) * Math.sin(p.heading));
            const z =
              p.z +
              1.08 *
                (-positions.getX(v) * Math.sin(p.heading) +
                  positions.getZ(v) * Math.cos(p.heading));
            const localX = Math.abs(x - Math.round(x / BLOCK_PITCH) * BLOCK_PITCH);
            const localZ = Math.abs(z - Math.round(z / BLOCK_PITCH) * BLOCK_PITCH);
            assert.ok(localX > LOT_HALF || localZ > LOT_HALF, 'body never clips a sidewalk');
            assert.ok(Math.max(Math.abs(x), Math.abs(z)) < CITY_EXTENT);
          }
        }
    }
    sampleTrafficLane(lane, TRAFFIC_LOOP_LENGTH - 0.00001, p);
    sampleTrafficLane(lane, 0, next);
    assert.ok(Math.hypot(p.x - next.x, p.z - next.z) < 0.00002);
    assert.ok(Math.abs(Math.sin(p.heading) - Math.sin(next.heading)) < 0.00002);
  }
  car.dispose();
  bike.dispose();
});

test('near traffic moves, distant traffic pauses, and reduced motion removes trails', () => {
  const traffic = new Traffic();
  const cars = mesh(traffic, 'traffic-car-body');
  const bikes = mesh(traffic, 'traffic-bike-body');
  assert.equal(bikes.count, TRAFFIC_LANES.length, 'each road loop has a Grab motorbike');
  assert.ok(cars.count >= bikes.count, 'car traffic remains present');
  assert.equal(mesh(traffic, 'traffic-bike-grab-delivery-box').count, bikes.count);
  const before = Array.from({ length: cars.count }, (_, i) => matrixAt(cars, i));
  traffic.update(1 / 60);
  let moving = 0,
    paused = 0;
  for (let i = 0; i < cars.count; i++) {
    const p = new Vector3().setFromMatrixPosition(before[i]);
    const near = Math.max(Math.abs(Math.round(p.x / 10)), Math.abs(Math.round(p.z / 10))) <= 2;
    assert.equal(matrixAt(cars, i).equals(before[i]), !near);
    if (near) moving++;
    else paused++;
  }
  assert.ok(moving > 0 && paused > 0);
  traffic.setFocus(10, 10);
  traffic.update(0, true);
  const held = cars.instanceMatrix.array.slice();
  traffic.update(0.05, true);
  assert.deepEqual(cars.instanceMatrix.array, held);
  const trails = mesh(traffic, 'traffic-light-trails');
  for (let i = 0; i < trails.count; i++) {
    const scale = new Vector3().setFromMatrixScale(matrixAt(trails, i));
    assert.equal(scale.x, 0, 'stationary vehicles have no trail');
  }
  traffic.update(0.05);
  assert.notDeepEqual(cars.instanceMatrix.array, held, 'motion can resume');
  traffic.dispose();
});

test('vehicles and their trails gray with their block; headlights brighten after dark', () => {
  const traffic = new Traffic();
  const selected = blockKeyAt(0, 0);
  traffic.applyEmphasis((key) => (key === selected ? 1 : BACKGROUND_EMPHASIS));
  const cars = mesh(traffic, 'traffic-car-body');
  const color = new Color();
  let focused = 0;
  for (let i = 0; i < cars.count; i++) {
    const p = new Vector3().setFromMatrixPosition(matrixAt(cars, i));
    cars.getColorAt(i, color);
    if (blockKeyAt(p.x, p.z) === selected) {
      focused++;
      assert.notEqual(color.r, color.b);
    } else {
      assert.equal(color.r, color.g);
      assert.equal(color.g, color.b);
    }
  }
  assert.ok(focused > 0);
  traffic.applyEmphasis(() => BACKGROUND_EMPHASIS);
  const trails = mesh(traffic, 'traffic-light-trails');
  for (let i = 0; i < trails.count; i++) {
    trails.getColorAt(i, color);
    assert.equal(color.r, color.g);
    assert.equal(color.g, color.b);
  }
  const lamp = mesh(traffic, 'traffic-car-headlights').material as MeshBasicMaterial;
  traffic.setNight(0);
  const day = lamp.color.r;
  traffic.setNight(1);
  assert.ok(lamp.color.r > day * 3);
  traffic.dispose();
});

test('traffic releases instanced buffers and asset-owned resources', () => {
  const assets = [new PrimitiveVehicleAsset('car'), new PrimitiveVehicleAsset('bike')];
  let geometryDisposed = 0,
    materialDisposed = 0,
    meshDisposed = 0;
  const materials = new Set(assets.flatMap((asset) => asset.parts.map((part) => part.material)));
  for (const asset of assets)
    for (const part of asset.parts)
      part.geometry.addEventListener('dispose', () => geometryDisposed++);
  for (const material of materials) material.addEventListener('dispose', () => materialDisposed++);
  const traffic = new Traffic(assets);
  const count = traffic.root.children.length;
  traffic.root.traverse((object) => {
    if (object instanceof InstancedMesh) object.addEventListener('dispose', () => meshDisposed++);
  });
  traffic.dispose();
  assert.equal(
    geometryDisposed,
    assets.reduce((n, asset) => n + asset.parts.length, 0),
  );
  assert.equal(materialDisposed, materials.size);
  assert.equal(meshDisposed, count);
  assert.equal(traffic.root.children.length, 0);
});

test('light trails meet the real bulb faces and stay joined through turns at time-lapse speed', () => {
  const assets = [new PrimitiveVehicleAsset('car'), new PrimitiveVehicleAsset('bike')];
  const traffic = new Traffic(assets);
  const trails = mesh(traffic, 'traffic-light-trails');
  const heads: Vector3[] = [];
  const front = new Vector3(),
    back = new Vector3(),
    previous = new Vector3();
  for (let frame = 0; frame < 60; frame++) {
    traffic.update(0.05, false, 12);
    heads.length = 0;
    for (let start = 0; start < trails.count; start += 7) {
      const first = matrixAt(trails, start);
      if (new Vector3().setFromMatrixScale(first).x === 0) continue;
      heads.push(new Vector3(0, 0, 0.5).applyMatrix4(first));
      for (let segment = 0; segment < 7; segment++) {
        const matrix = matrixAt(trails, start + segment);
        front.set(0, 0, 0.5).applyMatrix4(matrix);
        back.set(0, 0, -0.5).applyMatrix4(matrix);
        if (segment > 0)
          assert.ok(front.distanceTo(previous) < 1e-5, 'adjacent trail pieces connect');
        assert.ok(front.y > 0.2, 'trail stays at bulb height, above the road');
        previous.copy(back);
      }
    }
    let bulbs = 0;
    for (const asset of assets) {
      const bodies = mesh(traffic, `traffic-${asset.kind}-body`);
      const geometry = asset.parts.find((part) => part.name.startsWith('taillight'))!.geometry;
      geometry.computeBoundingBox();
      for (const bulb of asset.rearLights)
        assert.ok(
          Math.abs(geometry.boundingBox!.min.z - bulb.position[2]) < 1e-6,
          'anchor is on the visible rear face',
        );
      for (let i = 0; i < bodies.count; i++) {
        const transform = matrixAt(bodies, i);
        const p = new Vector3().setFromMatrixPosition(transform);
        if (Math.max(Math.abs(Math.round(p.x / 10)), Math.abs(Math.round(p.z / 10))) > 2) continue;
        for (const bulb of asset.rearLights) {
          const expected = new Vector3(...bulb.position).applyMatrix4(transform);
          assert.ok(
            heads.some((head) => head.distanceTo(expected) < 1e-5),
            'trail starts exactly on its transformed bulb',
          );
          bulbs++;
        }
      }
    }
    assert.equal(heads.length, bulbs, 'each moving bulb has exactly one trail');
  }
  traffic.dispose();
});

test('traffic speed follows 4x and 12x time-lapse without the frame clamp swallowing the multiplier', () => {
  for (const speed of [4, 12]) {
    const fast = new Traffic(),
      baseline = new Traffic();
    for (let i = 0; i < 10; i++) {
      fast.update(1 / 60, false, speed);
      for (let substep = 0; substep < speed; substep++) baseline.update(1 / 60);
    }
    const actual = mesh(fast, 'traffic-car-body').instanceMatrix.array;
    const expected = mesh(baseline, 'traffic-car-body').instanceMatrix.array;
    for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-5);
    const held = actual.slice();
    fast.update(0.05, true, speed);
    assert.deepEqual(actual, held, 'reduced motion still freezes accelerated traffic');
    fast.dispose();
    baseline.dispose();
  }
});
