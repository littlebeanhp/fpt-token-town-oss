import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  PointLight,
  SpotLight,
  Vector3,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu';
import type { LightingSample } from './CityClock';
import {
  FOG_NEAR_OFFSET,
  FOG_FAR_OFFSET,
  BLOCK_PITCH,
  LAMP_OFFSETS,
  LAMP_HEAD_HEIGHT,
  SIDEWALK_HEIGHT,
  blockIndex,
} from './layout';

const LIGHT_DISTANCE = 42;
const SHADOW_HALF_SIZE = 16;

export class Lighting {
  readonly sun = new DirectionalLight('#fff4dc', 3.3);
  readonly ambient = new HemisphereLight('#e6f6ff', '#39443f', 0.65);
  /** Local window spill onto the entrance, with occlusion instead of a whole-block fill. */
  readonly focusLight = new SpotLight('#ffcf94', 0, 8, Math.PI / 3, 0.65, 2);
  private readonly windowLights = [
    new PointLight('#ffd49a', 0, 5, 2),
    new PointLight('#ffdfb0', 0, 5, 2),
  ];
  private readonly windowPositions = [new Vector3(-1, 3, 2), new Vector3(1, 3, 2)];
  setWindowPosition(index: number, position: Vector3) {
    this.windowPositions[index].copy(position);
  }
  private facade = new Vector3(0, 2, 2);
  /** Set once the entrance spotlight's shadow map has been rendered at least one frame. */
  private shadowPrimed = false;
  private readonly streetLights = Array.from(
    { length: LAMP_OFFSETS.length },
    () => new PointLight('#ffdaab', 0, 6, 2),
  );
  setFacade(x: number, y: number, z: number) {
    this.facade.set(x, y, z);
  }
  // Distant blocks fade into the sky color, so the far city reads as atmosphere, not an edge.
  readonly fog = new Fog('#e7ede9', 30, 110);
  private background = new Color('#e7ede9');
  constructor(scene: Scene, renderer: WebGPURenderer) {
    scene.background = this.background;
    scene.fog = this.fog;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -SHADOW_HALF_SIZE;
    shadowCamera.right = SHADOW_HALF_SIZE;
    shadowCamera.top = SHADOW_HALF_SIZE;
    shadowCamera.bottom = -SHADOW_HALF_SIZE;
    shadowCamera.near = 1;
    shadowCamera.far = LIGHT_DISTANCE * 2.2;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.bias = -0.0002;
    this.focusLight.castShadow = true;
    this.focusLight.shadow.mapSize.set(512, 512);
    this.focusLight.shadow.camera.near = 0.1;
    this.focusLight.shadow.normalBias = 0.015;
    this.focusLight.shadow.bias = -0.0001;
    scene.add(
      this.sun,
      this.sun.target,
      this.ambient,
      this.focusLight,
      this.focusLight.target,
      ...this.streetLights,
      ...this.windowLights,
    );
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
  }
  /** Applies a time-of-day sample; the key light and its shadow frustum follow the focus. */
  apply(sample: LightingSample, focus: Vector3) {
    this.background.copy(sample.sky);
    this.fog.color.copy(sample.sky);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(sample.lightDirection, LIGHT_DISTANCE);
    this.sun.target.updateMatrixWorld();
    this.sun.intensity = sample.lightIntensity;
    this.sun.color.copy(sample.lightColor);
    this.ambient.color.copy(sample.hemiSky);
    this.ambient.groundColor.copy(sample.hemiGround);
    this.ambient.intensity = sample.hemiIntensity;
    this.focusLight.position.copy(this.facade);
    this.focusLight.target.position.set(this.facade.x, SIDEWALK_HEIGHT, this.facade.z + 2);
    this.focusLight.target.updateMatrixWorld();
    this.focusLight.intensity = sample.night * 18;
    // The entrance spill only exists after dusk. Parking its shadow map in daylight skips a
    // whole geometry pass over the city; `castShadow` stays on, so no material is recompiled
    // when the lamp comes back. It is always drawn once first: WebGPU rejects a submit that
    // samples a shadow map which has never been rendered.
    this.focusLight.shadow.autoUpdate = sample.night > 0.01 || !this.shadowPrimed;
    this.shadowPrimed = true;
    this.windowLights.forEach((light, index) => {
      light.position.copy(this.windowPositions[index]);
      light.intensity = 0.15 + sample.night * 5;
    });
    const x = blockIndex(focus.x) * BLOCK_PITCH,
      z = blockIndex(focus.z) * BLOCK_PITCH;
    this.streetLights.forEach((light, index) => {
      light.position.set(
        x + LAMP_OFFSETS[index][0],
        SIDEWALK_HEIGHT + LAMP_HEAD_HEIGHT,
        z + LAMP_OFFSETS[index][1],
      );
      light.intensity = sample.night * 7;
    });
  }
  /** Keeps fog relative to the camera so every framing hides the same far distance. */
  setFogRange(cameraDistance: number) {
    this.fog.near = cameraDistance + FOG_NEAR_OFFSET;
    this.fog.far = cameraDistance + FOG_FAR_OFFSET;
  }
  dispose() {
    this.sun.shadow.dispose();
    this.focusLight.shadow.dispose();
  }
}
