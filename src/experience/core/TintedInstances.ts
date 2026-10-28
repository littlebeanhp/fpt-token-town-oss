import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  type BufferGeometry,
  type Material,
  type Matrix4,
} from 'three/webgpu';
import { tintForEmphasis } from './emphasis';

/**
 * An InstancedMesh whose per-instance colors follow the focus emphasis of the city block
 * each instance belongs to. Colors are rewritten only when emphasis changes.
 */
export class TintedInstances {
  readonly mesh: InstancedMesh;
  private readonly base: Float32Array;
  private readonly keys: Int32Array;
  private readonly colors: InstancedBufferAttribute;
  private readonly scratch = new Color();
  private count = 0;

  constructor(geometry: BufferGeometry, material: Material, capacity: number, dynamic = false) {
    this.mesh = new InstancedMesh(geometry, material, Math.max(capacity, 1));
    this.base = new Float32Array(Math.max(capacity, 1) * 3);
    this.keys = new Int32Array(Math.max(capacity, 1));
    this.colors = new InstancedBufferAttribute(new Float32Array(Math.max(capacity, 1) * 3), 3);
    this.mesh.instanceColor = this.colors;
    if (dynamic) this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
  }
  /** Appends an instance and returns its index. */
  add(matrix: Matrix4, color: Color, key: number) {
    const index = this.count++;
    this.mesh.setMatrixAt(index, matrix);
    this.base.set([color.r, color.g, color.b], index * 3);
    this.colors.array.set([color.r, color.g, color.b], index * 3);
    this.keys[index] = key;
    this.mesh.count = this.count;
    return index;
  }
  setMatrix(index: number, matrix: Matrix4) {
    this.mesh.setMatrixAt(index, matrix);
  }
  commitMatrices() {
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  applyEmphasis(emphasisForKey: (key: number) => number) {
    const array = this.colors.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const offset = i * 3;
      tintForEmphasis(
        this.base[offset],
        this.base[offset + 1],
        this.base[offset + 2],
        emphasisForKey(this.keys[i]),
        this.scratch,
      );
      array[offset] = this.scratch.r;
      array[offset + 1] = this.scratch.g;
      array[offset + 2] = this.scratch.b;
    }
    this.colors.needsUpdate = true;
  }
  dispose() {
    this.mesh.dispose();
  }
}
