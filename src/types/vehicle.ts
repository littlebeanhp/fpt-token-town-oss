import type { BufferGeometry, Color, Material } from 'three/webgpu';

export type VehicleKind = 'car' | 'bike';
export interface VehiclePart {
  readonly name: string;
  /** Geometry is authored in meters, Y-up, facing +Z, with tires resting at Y=0. */
  readonly geometry: BufferGeometry;
  readonly material: Material;
  readonly color: Color | 'paint';
  readonly luminous?: boolean;
}
export interface VehicleLight {
  /** Center of the visible bulb's outer face, in model-local coordinates. */
  readonly position: readonly [x: number, y: number, z: number];
  readonly color: string;
}
/** Replaceable model source. Traffic owns instances; the asset owns geometry and materials. */
export interface VehicleAsset {
  readonly kind: VehicleKind;
  readonly parts: readonly VehiclePart[];
  readonly rearLights: readonly VehicleLight[];
  setNight(value: number): void;
  dispose(): void;
}
