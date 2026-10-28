// Offline conversion: the supplied archive has FBX geometry but no external textures.
import { readFileSync, writeFileSync } from 'node:fs';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  LoadingManager,
  Texture,
  Float32BufferAttribute,
  Color,
  MeshStandardMaterial,
  Scene,
} from 'three';
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw Error('Usage: node scripts/convert-quaternius-tree.mjs input.fbx output.glb');
const manager = new LoadingManager();
manager.addHandler(/.*/, {
  setPath() {
    return this;
  },
  load() {
    return new Texture();
  },
});
const bytes = readFileSync(input);
const source = new FBXLoader(manager).parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);
source.updateMatrixWorld(true);
const meshes = [];
source.traverse((node) => {
  if (node.isMesh) meshes.push(node);
});
const tree = meshes.sort(
  (a, b) => a.geometry.attributes.position.count - b.geometry.attributes.position.count,
)[0];
const geometry = tree.geometry.clone();
geometry.applyMatrix4(tree.matrixWorld);
const colors = new Float32Array(geometry.attributes.position.count * 3);
for (const group of geometry.groups) {
  const material = tree.material[group.materialIndex];
  const color = new Color(material.name.includes('Leaves') ? '#73974f' : '#755039');
  for (let i = group.start; i < group.start + group.count; i++) color.toArray(colors, i * 3);
}
geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
geometry.deleteAttribute('uv');
geometry.clearGroups();
tree.removeFromParent();
tree.position.set(0, 0, 0);
tree.rotation.set(0, 0, 0);
tree.scale.set(1, 1, 1);
tree.geometry = geometry;
tree.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
const scene = new Scene();
scene.add(tree);
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = 'data:' + blob.type + ';base64,' + Buffer.from(result).toString('base64');
      this.onloadend?.();
    });
  }
};
const result = await new GLTFExporter().parseAsync(scene, { binary: true });
writeFileSync(output, Buffer.from(result));
console.log(tree.name, geometry.attributes.position.count / 3, 'triangles');
