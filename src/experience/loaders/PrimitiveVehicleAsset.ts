import { BoxGeometry, Color, MeshBasicMaterial, MeshStandardMaterial } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleAsset, VehicleKind, VehicleLight, VehiclePart } from '@/types/vehicle';

type Box = [x: number, y: number, z: number, width: number, height: number, depth: number];

/** A small hatchback or step-through bike and rider, batched by material role. */
export class PrimitiveVehicleAsset implements VehicleAsset {
  readonly parts: VehiclePart[] = [];
  readonly rearLights: readonly VehicleLight[];
  private body = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
  private lights = new MeshBasicMaterial({ color: '#ffffff' });

  constructor(
    readonly kind: VehicleKind,
    private readonly riderParts?: VehiclePart[],
  ) {
    const car = kind === 'car';
    this.rearLights = (car ? [-0.16, 0.16] : [0]).map((x) => ({
      position: [x, car ? 0.24 : 0.27, car ? -0.4975 : -0.265] as const,
      color: '#f16f52',
    }));
    const part = (name: string, color: string, boxes: Box[], luminous = false) => {
      const pieces = boxes.map(([x, y, z, w, h, d]) => new BoxGeometry(w, h, d).translate(x, y, z));
      const geometry = mergeGeometries(pieces);
      pieces.forEach((piece) => piece.dispose());
      this.parts.push({
        name,
        geometry,
        material: luminous ? this.lights : this.body,
        color: color === 'paint' ? 'paint' : new Color(color),
        luminous,
      });
    };
    if (car) {
      part('body', 'paint', [
        [0, 0.22, 0, 0.48, 0.22, 0.96],
        [0, 0.4, -0.05, 0.4, 0.17, 0.46],
      ]);
      part('windows', '#45616a', [
        [0, 0.4, 0.188, 0.34, 0.13, 0.018],
        [0, 0.4, -0.288, 0.34, 0.12, 0.018],
        [-0.205, 0.4, -0.05, 0.014, 0.12, 0.36],
        [0.205, 0.4, -0.05, 0.014, 0.12, 0.36],
      ]);
      part('wheels', '#26343a', [
        [-0.23, 0.105, -0.3, 0.085, 0.21, 0.19],
        [0.23, 0.105, -0.3, 0.085, 0.21, 0.19],
        [-0.23, 0.105, 0.3, 0.085, 0.21, 0.19],
        [0.23, 0.105, 0.3, 0.085, 0.21, 0.19],
      ]);
      part(
        'headlights',
        '#fff0c6',
        [
          [-0.16, 0.24, 0.485, 0.1, 0.075, 0.025],
          [0.16, 0.24, 0.485, 0.1, 0.075, 0.025],
        ],
        true,
      );
    } else {
      part('body', 'paint', [
        [0, 0.23, 0, 0.16, 0.17, 0.48],
        [0, 0.32, 0.2, 0.14, 0.3, 0.12],
      ]);
      part('wheels-seat', '#26343a', [
        [0, 0.12, -0.25, 0.085, 0.24, 0.2],
        [0, 0.12, 0.25, 0.085, 0.24, 0.2],
        [0, 0.34, -0.09, 0.19, 0.055, 0.26],
        [0, 0.46, 0.23, 0.3, 0.035, 0.045],
      ]);
      if (riderParts) this.parts.push(...riderParts);
      else {
        part('rider', '#00b14f', [
          [0, 0.5, -0.06, 0.22, 0.26, 0.15],
          [-0.1, 0.3, 0.02, 0.065, 0.23, 0.1],
          [0.1, 0.3, 0.02, 0.065, 0.23, 0.1],
          [-0.12, 0.48, 0.1, 0.055, 0.07, 0.23],
          [0.12, 0.48, 0.1, 0.055, 0.07, 0.23],
        ]);
        part('helmet', '#00b14f', [[0, 0.7, -0.03, 0.2, 0.19, 0.2]]);
        part('grab-delivery-box', '#00b14f', [[0, 0.5, -0.29, 0.28, 0.28, 0.22]]);
        part('grab-white-mark', '#ffffff', [[0, 0.52, -0.405, 0.16, 0.045, 0.012]]);
      }
      part('headlight', '#fff0c6', [[0, 0.44, 0.268, 0.09, 0.075, 0.02]], true);
    }
    // Bulb geometry and trail origins share one source of truth.
    const depth = car ? 0.025 : 0.02;
    part(
      car ? 'taillights' : 'taillight',
      this.rearLights[0].color,
      this.rearLights.map(
        ({ position: [x, y, z] }) =>
          [x, y, z + depth / 2, car ? 0.095 : 0.07, car ? 0.06 : 0.05, depth] as Box,
      ),
      true,
    );
  }
  setNight(value: number) {
    this.lights.color.setScalar(0.7 + value * 2.3);
  }
  dispose() {
    for (const part of this.parts) part.geometry.dispose();
    for (const material of new Set(this.riderParts?.map((part) => part.material)))
      material.dispose();
    this.body.dispose();
    this.lights.dispose();
  }
}
