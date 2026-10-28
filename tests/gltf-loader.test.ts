import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three/webgpu';
import { models } from '../src/data/models';
import { GLTFFactoryAsset } from '../src/experience/loaders/GLTFFactoryAsset';

test('GLTFLoader reads a binary asset, preserves authored anchors, and generates missing ones', async () => {
  if (!globalThis.ProgressEvent) {
    Object.defineProperty(globalThis, 'ProgressEvent', {
      value: class extends Event {
        constructor(type: string, init: Record<string, unknown>) {
          super(type);
          Object.assign(this, init);
        }
      },
      configurable: true,
    });
  }
  const binary = Buffer.alloc(36);
  [0, 0, 0, 3, 0, 0, 0, 3, 0].forEach((value, index) => binary.writeFloatLE(value, index * 4));
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'ROOT', children: [1, 2, 3] },
      { name: 'VISUAL', mesh: 0 },
      { name: 'COLLIDER', mesh: 0 },
      { name: 'CameraAnchor', translation: [5, 6, 9] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.length }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [3, 3, 0],
      },
    ],
  };
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const glb = Buffer.alloc(12 + 8 + padded.length + 8 + binary.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20);
  const binaryOffset = 20 + padded.length;
  glb.writeUInt32LE(binary.length, binaryOffset);
  glb.writeUInt32LE(0x004e4942, binaryOffset + 4);
  binary.copy(glb, binaryOffset + 8);
  const asset = await GLTFFactoryAsset.load({
    ...models[0],
    assetUrl: `data:application/octet-stream;base64,${glb.toString('base64')}`,
  });
  asset.root.updateMatrixWorld(true);
  // The authored anchor (5, 6, 9) is local to the model and follows it into the city.
  const [x, y, z] = models[0].position;
  const anchor = asset.getAnchor('CameraAnchor', new Vector3());
  assert.ok(anchor.distanceTo(new Vector3(x + 5, y + 6, z + 9)) < 1e-9);
  assert.ok(asset.getAnchor('UIAnchor', new Vector3()).y > 3);
  assert.equal(asset.colliders.length, 1);
  assert.equal(asset.root.getObjectByName('COLLIDER')!.visible, false);
  asset.setEmphasis(0.3);
  asset.setNight(1);
  asset.dispose();
});
