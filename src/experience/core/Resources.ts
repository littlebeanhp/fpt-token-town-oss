import {
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  type ColorRepresentation,
  type Group,
} from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export class Resources {
  private boxGeometry?: RoundedBoxGeometry;
  private cubeGeometry?: BoxGeometry;
  private cylinderGeometry?: CylinderGeometry;
  private ringGeometry?: TorusGeometry;
  get box() {
    return (this.boxGeometry ??= new RoundedBoxGeometry(1, 1, 1, 1, 0.045));
  }
  get cube() {
    return (this.cubeGeometry ??= new BoxGeometry(1, 1, 1));
  }
  get cylinder() {
    return (this.cylinderGeometry ??= new CylinderGeometry(1, 1, 1, 8));
  }
  get ring() {
    return (this.ringGeometry ??= new TorusGeometry(1, 0.025, 4, 48));
  }
  private materials = new Map<string, MeshStandardMaterial>();

  material(color: ColorRepresentation, emissive = false) {
    const key = `${color}-${emissive}`;
    if (!this.materials.has(key))
      this.materials.set(
        key,
        new MeshStandardMaterial({
          color,
          roughness: 0.65,
          metalness: 0.12,
          ...(emissive ? { emissive: color, emissiveIntensity: 1.2 } : {}),
        }),
      );
    return this.materials.get(key)!;
  }
  block(
    parent: Group,
    position: [number, number, number],
    scale: [number, number, number],
    material: MeshStandardMaterial,
  ) {
    const mesh = new Mesh(this.box, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  dispose() {
    this.boxGeometry?.dispose();
    this.cubeGeometry?.dispose();
    this.cylinderGeometry?.dispose();
    this.ringGeometry?.dispose();
    this.materials.forEach((material) => material.dispose());
  }
}
