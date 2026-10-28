import { Box3, Color, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three/webgpu';
import type { AnchorName, FactoryAsset } from '@/types/factory';
import { tintForEmphasis } from '../core/emphasis';

export abstract class AssetBase implements FactoryAsset {
  readonly colliders: Object3D[] = [];
  protected anchors = new Map<AnchorName, Object3D>();
  protected surfaces: {
    material: MeshStandardMaterial;
    color: Color;
    emissive: Color;
    emission: number;
  }[] = [];
  protected emphasis = 1;
  protected night = 0;
  constructor(readonly root: Group) {}

  protected prepare() {
    this.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.root);
    const size = box.getSize(new Vector3());
    const height = Math.max(size.y, 2);
    const defaults: Record<AnchorName, [number, number, number]> = {
      CameraTarget: [0, height * 0.42, 0],
      CameraAnchor: [5, height * 0.42 + 7, 10],
      // Without an authored entrance the whole frontage is the door, so aim at the middle of it.
      Doorway: [0, 0.9, box.max.z],
      TokenInput: [-2.3, 0.65, 0],
      TokenOutput: [2.3, 0.65, 0],
      UIAnchor: [0, height + 0.8, 0],
    };
    for (const name of Object.keys(defaults) as AnchorName[]) {
      let anchor = this.root.getObjectByName(name);
      if (!anchor) {
        anchor = new Object3D();
        anchor.name = name;
        anchor.position.set(...defaults[name]);
        this.root.add(anchor);
      }
      this.anchors.set(name, anchor);
    }
    const collider = this.root.getObjectByName('COLLIDER');
    if (collider) {
      // Hidden collider geometry still participates in explicit raycasts.
      collider.visible = false;
      collider.traverse((node) => {
        if (node instanceof Mesh) this.colliders.push(node);
      });
    } else {
      (this.root.getObjectByName('VISUAL') ?? this.root).traverse((node) => {
        if (node instanceof Mesh) this.colliders.push(node);
      });
    }
    const seen = new Set<MeshStandardMaterial>();
    this.root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material instanceof MeshStandardMaterial && !seen.has(material)) {
          seen.add(material);
          this.surfaces.push({
            material,
            color: material.color.clone(),
            emissive: material.emissive.clone(),
            emission: material.emissiveIntensity,
          });
        }
      }
    });
  }
  getAnchor(name: AnchorName, target: Vector3) {
    return this.anchors.get(name)!.getWorldPosition(target);
  }
  setEmphasis(value: number) {
    this.emphasis = value;
    this.applySurfaces();
  }
  setNight(value: number) {
    this.night = value;
    this.applySurfaces();
  }
  private applySurfaces() {
    for (const { material, color, emissive, emission } of this.surfaces) {
      // Background factories turn gray, including their glow, so only the focus reads in color.
      tintForEmphasis(color.r, color.g, color.b, this.emphasis, material.color);
      tintForEmphasis(emissive.r, emissive.g, emissive.b, this.emphasis, material.emissive);
      material.emissiveIntensity =
        emission * (0.55 + this.night * 2) * (0.35 + this.emphasis * 0.65);
    }
  }
  abstract dispose(): void;
}
