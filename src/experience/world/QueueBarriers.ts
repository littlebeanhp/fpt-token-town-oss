import {
  Color,
  CylinderGeometry,
  Group,
  MeshStandardMaterial,
  Object3D,
  QuadraticBezierCurve3,
  TubeGeometry,
  Vector3,
} from 'three/webgpu';
import { TintedInstances } from '../core/TintedInstances';
import { SIDEWALK_HEIGHT } from './layout';
import { createQueueLayout, type QueueSite } from './QueueLayout';

/** Silver stanchions and small sagging red ropes, instanced across the six model shops. */
export class QueueBarriers {
  readonly root = new Group();
  private readonly cylinder = new CylinderGeometry(1, 1, 1, 8);
  private readonly rope = new TubeGeometry(
    new QuadraticBezierCurve3(
      new Vector3(-0.5, 0, 0),
      new Vector3(0, -0.16, 0),
      new Vector3(0.5, 0, 0),
    ),
    12,
    0.025,
    5,
    false,
  );
  private readonly metal = new MeshStandardMaterial({
    color: '#ffffff',
    metalness: 0.55,
    roughness: 0.38,
  });
  private readonly fabric = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  private readonly batches: TintedInstances[];

  constructor(sites: readonly QueueSite[]) {
    this.root.name = 'shop-queue-barriers';
    const layouts = sites.map(createQueueLayout);
    const spans: { ax: number; az: number; bx: number; bz: number; key: number }[] = [];
    const posts = new Map<string, { x: number; z: number; key: number }>();
    for (const layout of layouts)
      for (const [a, b] of layout.rails) {
        const count = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.85);
        for (let i = 0; i <= count; i++) {
          const x = a.x + ((b.x - a.x) * i) / count,
            z = a.z + ((b.z - a.z) * i) / count;
          posts.set(`${x.toFixed(4)},${z.toFixed(4)}`, { x, z, key: layout.key });
          if (i < count)
            spans.push({
              ax: x,
              az: z,
              bx: a.x + ((b.x - a.x) * (i + 1)) / count,
              bz: a.z + ((b.z - a.z) * (i + 1)) / count,
              key: layout.key,
            });
        }
      }
    const bases = new TintedInstances(this.cylinder, this.metal, posts.size);
    const poles = new TintedInstances(this.cylinder, this.metal, posts.size);
    const caps = new TintedInstances(this.cylinder, this.metal, posts.size);
    const ropes = new TintedInstances(this.rope, this.fabric, spans.length);
    this.batches = [bases, poles, caps, ropes];
    const names = ['queue-bases', 'queue-posts', 'queue-caps', 'queue-red-ropes'];
    this.batches.forEach((batch, i) => {
      batch.mesh.name = names[i];
      this.root.add(batch.mesh);
    });
    const dummy = new Object3D();
    const silver = new Color('#c8d1d3'),
      dark = new Color('#34454b'),
      red = new Color('#ef2929');
    for (const { x, z, key } of posts.values()) {
      dummy.position.set(x, SIDEWALK_HEIGHT + 0.025, z);
      dummy.scale.set(0.09, 0.05, 0.09);
      dummy.updateMatrix();
      bases.add(dummy.matrix, silver, key);
      dummy.position.y = SIDEWALK_HEIGHT + 0.225;
      dummy.scale.set(0.025, 0.36, 0.025);
      dummy.updateMatrix();
      poles.add(dummy.matrix, silver, key);
      dummy.position.y = SIDEWALK_HEIGHT + 0.415;
      dummy.scale.set(0.04, 0.065, 0.04);
      dummy.updateMatrix();
      caps.add(dummy.matrix, dark, key);
    }
    for (const { ax, az, bx, bz, key } of spans) {
      dummy.position.set((ax + bx) / 2, SIDEWALK_HEIGHT + 0.4, (az + bz) / 2);
      dummy.rotation.y = -Math.atan2(bz - az, bx - ax);
      dummy.scale.set(Math.hypot(bx - ax, bz - az), 1, 1);
      dummy.updateMatrix();
      ropes.add(dummy.matrix, red, key);
    }
  }
  applyEmphasis(emphasisForKey: (key: number) => number) {
    for (const batch of this.batches) batch.applyEmphasis(emphasisForKey);
  }
  dispose() {
    for (const batch of this.batches) batch.dispose();
    this.cylinder.dispose();
    this.rope.dispose();
    this.metal.dispose();
    this.fabric.dispose();
    this.root.clear();
  }
}
