import { Group, InstancedMesh, Object3D } from 'three/webgpu';
import type { ModelDefinition } from '@/types/factory';
import { Resources } from '../core/Resources';
import { AssetBase } from './AssetBase';

export class PrimitiveFactoryAsset extends AssetBase {
  private resources = new Resources();
  constructor(model: ModelDefinition) {
    super(new Group());
    this.root.name = 'ROOT';
    const visual = new Group();
    visual.name = 'VISUAL';
    this.root.add(visual);
    const r = this.resources;
    const white = r.material('#e8efef'),
      dark = r.material('#36515e'),
      accent = r.material(model.color),
      glow = r.material(model.color, true);
    const block = (x: number, y: number, z: number, w: number, h: number, d: number, m = white) =>
      r.block(visual, [x, y, z], [w, h, d], m);
    block(0, 0.12, 0, 5.6, 0.24, 4.6, r.material('#b9ccce'));
    block(0, 0.28, 0, 5.2, 0.12, 4.2);
    switch (model.id) {
      case 'deepseek':
        block(-0.5, 1.3, -0.6, 3.4, 2, 2.3);
        block(-0.5, 2.4, -0.6, 3.7, 0.28, 2.6, accent);
        block(0, 0.72, 1.05, 4.7, 0.45, 0.9, dark);
        for (let i = 0; i < 7; i++) block(-2 + i * 0.64, 1, 1.05, 0.3, 0.2, 0.6, accent);
        block(1.2, 2.9, -0.7, 0.65, 1, 0.65, dark);
        break;
      case 'glm':
        block(0, 0.9, 0, 3.5, 1.2, 3);
        for (let i = 0; i < 4; i++) {
          block(0, 1.7 + i * 0.82, 0, 2.3 - i * 0.18, 0.7, 2.1 - i * 0.12);
          block(0, 2.08 + i * 0.82, 0, 2.55 - i * 0.18, 0.12, 2.3 - i * 0.12, accent);
        }
        block(0, 5.35, 0, 0.13, 1.1, 0.13, glow);
        break;
      case 'qwen':
        for (const [x, z, h] of [
          [-1.25, -0.8, 2.1],
          [1.25, -0.8, 2.8],
          [0, 1, 1.5],
        ]) {
          block(x, h / 2 + 0.3, z, 1.8, h, 1.6);
          block(x, h + 0.4, z, 2, 0.25, 1.8, accent);
        }
        block(0, 1.2, -0.8, 1, 0.5, 0.7, dark);
        block(0.6, 1, 0, 0.55, 0.5, 1.3, dark);
        break;
      case 'gemma-26b':
        block(0, 1.25, 0, 4.4, 1.9, 2.6);
        for (let i = 0; i < 4; i++) {
          block(-1.65 + i * 1.1, 2.35, 0, 0.95, 0.4, 2.8, accent);
          block(-1.65 + i * 1.1, 1.2, 1.33, 0.6, 1.25, 0.12, dark);
        }
        block(-1.8, 2.4, -1.3, 0.5, 2.8, 0.5, dark);
        block(-1.8, 3.85, -1.3, 0.7, 0.2, 0.7, accent);
        break;
      case 'tts':
        block(0, 1, 0, 3.2, 1.6, 2.6);
        block(0, 1.9, 0, 3.5, 0.22, 2.9, accent);
        block(0, 2.35, -0.2, 1.5, 0.7, 1.4);
        block(0, 2.76, -0.2, 1.7, 0.14, 1.6, glow);
        block(0, 1.35, 1.35, 2.6, 0.12, 0.5, dark);
        break;
      case 'llama':
        block(-1.45, 1.15, 0, 1.35, 1.7, 2.8);
        block(1.45, 1.15, 0, 1.35, 1.7, 2.8);
        block(0, 1, -0.8, 2.5, 1.4, 1.1, dark);
        block(0, 2.1, 0, 4.6, 0.25, 3.1, accent);
        block(0, 2.5, -0.25, 1.6, 0.65, 1.5);
        block(0, 2.85, -0.25, 1.7, 0.13, 1.6, glow);
        break;
      case 'gemma-31b':
        block(-0.7, 1.25, 0, 2.9, 1.9, 2.8);
        block(-0.7, 2.3, 0, 3.15, 0.2, 3, accent);
        for (let i = 0; i < 2; i++) {
          const tower = new Object3D();
          tower.position.set(1.6, 1.75, -0.7 + i * 1.5);
          const cylinder = new InstancedMesh(r.cylinder, dark, 1);
          tower.scale.set(0.65, 2.9, 0.65);
          tower.updateMatrix();
          cylinder.setMatrixAt(0, tower.matrix);
          cylinder.castShadow = true;
          visual.add(cylinder);
          block(1.6, 3.25, -0.7 + i * 1.5, 1.4, 0.22, 1.4, glow);
        }
        break;
    }
    // Repeated window strips share one instanced draw call per factory.
    const windows = new InstancedMesh(r.cube, glow, 8);
    const dummy = new Object3D();
    for (let i = 0; i < 8; i++) {
      dummy.position.set(-1.55 + (i % 4) * 0.63, 1.05 + Math.floor(i / 4) * 0.56, 1.42);
      dummy.scale.set(0.35, 0.18, 0.045);
      dummy.updateMatrix();
      windows.setMatrixAt(i, dummy.matrix);
    }
    visual.add(windows);
    block(-2.3, 0.63, 0, 0.42, 0.5, 0.7, glow);
    block(2.3, 0.63, 0, 0.42, 0.5, 0.7, glow);
    this.prepare();
    this.root.position.set(...model.position);
  }
  dispose() {
    this.root.traverse((node) => {
      if (node instanceof InstancedMesh) node.dispose();
    });
    this.resources.dispose();
  }
}
