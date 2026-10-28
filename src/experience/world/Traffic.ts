import {
  AdditiveBlending,
  Color,
  Group,
  Matrix4,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { float, smoothstep, uniform, uv } from 'three/tsl';
import type { VehicleAsset, VehicleKind, VehicleLight, VehiclePart } from '@/types/vehicle';
import { TintedInstances } from '../core/TintedInstances';
import { PrimitiveVehicleAsset } from '../loaders/PrimitiveVehicleAsset';
import {
  BLOCK_PITCH,
  TRAFFIC_LANES,
  TRAFFIC_LOOP_LENGTH,
  blockIndex,
  createRandom,
  sampleTrafficLane,
  type LanePose,
  type TrafficLane,
} from './layout';

const PAINT = ['#e4ddd0', '#769ba1', '#dc9b67', '#789586', '#667d98', '#ba776e'];
export const TRAIL_SEGMENTS = 7;
export const VEHICLE_GROUND_CLEARANCE = 0.015;
interface Vehicle {
  lane: TrafficLane;
  asset: VehicleAsset;
  batches: TintedInstances[];
  index: number;
  trailStart: number;
  distance: number;
  speed: number;
  scale: number;
  active: boolean;
}

/** Sample the bulb's actual path, including its local offset rotating through a turn. */
export function sampleVehicleLight(
  lane: TrafficLane,
  distance: number,
  scale: number,
  light: VehicleLight,
  out: Vector3,
  pose: LanePose,
) {
  sampleTrafficLane(lane, distance, pose);
  const [x, y, z] = light.position;
  const cos = Math.cos(pose.heading),
    sin = Math.sin(pose.heading);
  return out.set(
    pose.x + (x * cos + z * sin) * scale,
    VEHICLE_GROUND_CLEARANCE + y * scale,
    pose.z + (-x * sin + z * cos) * scale,
  );
}

/** Ambient traffic follows the shared time-lapse motion speed. The supplied assets transfer ownership here. */
export class Traffic {
  readonly root = new Group();
  private readonly vehicles: Vehicle[] = [];
  private readonly batches: TintedInstances[] = [];
  private readonly trails: TintedInstances;
  private readonly trailGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly trailStrength = uniform(0.12);
  private readonly trailMaterial = new MeshBasicNodeMaterial({
    color: '#ffffff',
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly trailHead = new Vector3();
  private readonly trailTail = new Vector3();
  private readonly pose: LanePose = { x: 0, z: 0, heading: 0 };
  private readonly color = new Color();
  private readonly assets: readonly VehicleAsset[];
  private focusX = 0;
  private focusZ = 0;
  private focusDirty = true;

  constructor(assets?: readonly VehicleAsset[], riderParts?: VehiclePart[]) {
    assets ??= [new PrimitiveVehicleAsset('car'), new PrimitiveVehicleAsset('bike', riderParts)];
    this.assets = assets;
    this.root.name = 'vehicle-traffic';
    const byKind = new Map<VehicleKind, { asset: VehicleAsset; batches: TintedInstances[] }>();
    // At most three vehicles per loop. Capacity is shared by each model's component batches.
    const capacity = TRAFFIC_LANES.length * 3;
    for (const asset of assets) {
      const batches = asset.parts.map((part) => {
        const batch = new TintedInstances(part.geometry, part.material, capacity, true);
        batch.mesh.name = `traffic-${asset.kind}-${part.name}`;
        // Moving instances must not retain a bounding sphere computed from their initial poses.
        batch.mesh.frustumCulled = false;
        batch.mesh.castShadow = !part.luminous;
        batch.mesh.receiveShadow = !part.luminous;
        this.root.add(batch.mesh);
        this.batches.push(batch);
        return batch;
      });
      byKind.set(asset.kind, { asset, batches });
    }
    if (!byKind.has('car') || !byKind.has('bike'))
      throw new Error('Traffic requires car and bike assets');
    this.trailMaterial.opacityNode = this.trailStrength
      .mul(smoothstep(0, 0.3, uv().x))
      .mul(float(1).sub(smoothstep(0.7, 1, uv().x)));
    this.trails = new TintedInstances(
      this.trailGeometry,
      this.trailMaterial,
      capacity * 2 * TRAIL_SEGMENTS,
      true,
    );
    this.trails.mesh.name = 'traffic-light-trails';
    this.trails.mesh.castShadow = false;
    this.trails.mesh.receiveShadow = false;
    this.trails.mesh.frustumCulled = false;
    this.trails.mesh.renderOrder = 3;
    this.root.add(this.trails.mesh);
    const random = createRandom(31827);
    let trailStart = 0;
    for (const lane of TRAFFIC_LANES) {
      const count = 2 + (random() < 0.35 ? 1 : 0);
      const start = random() * TRAFFIC_LOOP_LENGTH;
      // One cruising speed per lane preserves the generous spacing without overtaking.
      const speed = 1.15 + random() * 0.75;
      for (let n = 0; n < count; n++) {
        const { asset, batches } = byKind.get(n === 0 ? 'bike' : 'car')!;
        const paint = PAINT[Math.floor(random() * PAINT.length)];
        let index = 0;
        for (let p = 0; p < batches.length; p++) {
          const color = asset.parts[p].color;
          index = batches[p].add(
            this.matrix,
            color === 'paint' ? this.color.set(paint) : color,
            lane.key,
          );
        }
        for (let light = 0; light < asset.rearLights.length; light++)
          for (let segment = 0; segment < TRAIL_SEGMENTS; segment++) {
            this.color
              .set(asset.rearLights[light].color)
              .multiplyScalar(Math.pow(1 - segment / TRAIL_SEGMENTS, 1.7));
            this.trails.add(this.matrix, this.color, lane.key);
          }
        this.vehicles.push({
          lane,
          asset,
          batches,
          index,
          trailStart,
          distance: start + (n * TRAFFIC_LOOP_LENGTH) / count,
          speed,
          scale: 0.88 + random() * 0.2,
          active: false,
        });
        trailStart += asset.rearLights.length * TRAIL_SEGMENTS;
      }
    }
    this.update(0);
  }

  /** A district owns the lane around its block, including its rounded corner turns. */
  setFocus(x: number, z: number) {
    this.focusX = blockIndex(x) * BLOCK_PITCH;
    this.focusZ = blockIndex(z) * BLOCK_PITCH;
    this.focusDirty = true;
  }
  private transform(
    pose: LanePose,
    offset: number,
    y: number,
    width: number,
    height: number,
    depth: number,
  ) {
    this.position.set(
      pose.x + Math.cos(pose.heading) * offset,
      y,
      pose.z - Math.sin(pose.heading) * offset,
    );
    this.rotation.setFromAxisAngle(this.up, pose.heading);
    this.matrix.compose(this.position, this.rotation, this.scale.set(width, height, depth));
    return this.matrix;
  }
  update(delta: number, reducedMotion = false, motionSpeed = 1) {
    const step = Math.min(Math.max(delta, 0), 0.05) * motionSpeed;
    let changed = false;
    for (const vehicle of this.vehicles) {
      const near =
        Math.max(Math.abs(vehicle.lane.x - this.focusX), Math.abs(vehicle.lane.z - this.focusZ)) <=
        BLOCK_PITCH * 2;
      const active = near && !reducedMotion;
      if (!this.focusDirty && !active && !vehicle.active) continue;
      vehicle.active = active;
      if (active)
        vehicle.distance = (vehicle.distance + vehicle.speed * step) % TRAFFIC_LOOP_LENGTH;
      const k = vehicle.scale;
      sampleTrafficLane(vehicle.lane, vehicle.distance, this.pose);
      this.transform(this.pose, 0, VEHICLE_GROUND_CLEARANCE, k, k, k);
      for (const batch of vehicle.batches) batch.setMatrix(vehicle.index, this.matrix);
      const length = (vehicle.asset.kind === 'car' ? 0.85 : 0.5) * k;
      const segmentLength = length / TRAIL_SEGMENTS;
      for (let light = 0; light < vehicle.asset.rearLights.length; light++) {
        const bulb = vehicle.asset.rearLights[light];
        sampleVehicleLight(vehicle.lane, vehicle.distance, k, bulb, this.trailHead, this.pose);
        for (let segment = 0; segment < TRAIL_SEGMENTS; segment++) {
          sampleVehicleLight(
            vehicle.lane,
            vehicle.distance - (segment + 1) * segmentLength,
            k,
            bulb,
            this.trailTail,
            this.pose,
          );
          // Each ribbon segment joins consecutive bulb positions. Its front edge starts
          // exactly at the lamp, at lamp height, even when the car is halfway around a turn.
          this.position.copy(this.trailHead).add(this.trailTail).multiplyScalar(0.5);
          this.rotation.setFromAxisAngle(
            this.up,
            Math.atan2(this.trailHead.x - this.trailTail.x, this.trailHead.z - this.trailTail.z),
          );
          this.matrix.compose(
            this.position,
            this.rotation,
            this.scale.set(active ? 0.075 * k : 0, 1, this.trailHead.distanceTo(this.trailTail)),
          );
          this.trails.setMatrix(vehicle.trailStart + light * TRAIL_SEGMENTS + segment, this.matrix);
          this.trailHead.copy(this.trailTail);
        }
      }
      changed = true;
    }
    if (changed) {
      for (const batch of this.batches) batch.commitMatrices();
      this.trails.commitMatrices();
    }
    this.focusDirty = false;
  }
  applyEmphasis(emphasisForKey: (key: number) => number) {
    for (const batch of this.batches) batch.applyEmphasis(emphasisForKey);
    this.trails.applyEmphasis(emphasisForKey);
  }
  setNight(value: number) {
    for (const asset of this.assets) asset.setNight(value);
    this.trailStrength.value = 0.12 + value * 0.78;
  }
  dispose() {
    for (const batch of this.batches) batch.dispose();
    this.trails.dispose();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
    for (const asset of this.assets) asset.dispose();
    this.root.clear();
  }
}
