import {
  MathUtils,
  RenderPipeline,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu';
import { length, mix, pass, screenUV, smoothstep, uniform, vec2 } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

/** Two quarter-resolution blur passes, with a sharp full-resolution district composite. */
export class FocusEffect {
  private readonly focusDistance = uniform(35);
  private readonly center = uniform(new Vector2(0.5, 0.5));
  private readonly radius = uniform(0.3);
  private readonly aspect = uniform(1);
  private readonly blurRadius = uniform(1.5);
  private readonly scenePass;
  private readonly blur;
  private readonly glow;
  private readonly pipeline: RenderPipeline;
  private readonly direction = new Vector3();
  private readonly offset = new Vector3();
  private readonly projected = new Vector3();

  constructor(
    private renderer: WebGPURenderer,
    scene: Scene,
    private camera: PerspectiveCamera,
  ) {
    this.scenePass = pass(scene, camera);
    const beauty = this.scenePass.getTextureNode('output');
    const depthDistance = this.scenePass.getViewZNode().negate().sub(this.focusDistance).abs();
    const screenDistance = length(screenUV.sub(this.center).mul(vec2(this.aspect, 1)));
    const radial = smoothstep(this.radius.mul(0.95), this.radius.mul(1.65), screenDistance);
    const depth = smoothstep(3.4, 8, depthDistance);
    const mask = depth.max(radial);
    this.blur = gaussianBlur(beauty, this.blurRadius, 2, { resolutionScale: 0.25 });
    // HDR highlights spread beyond the bright windows before tone mapping.
    this.glow = gaussianBlur(beauty.sub(1.2).max(0), uniform(2), 2, { resolutionScale: 0.25 });
    this.pipeline = new RenderPipeline(
      renderer,
      mix(beauty, this.blur, mask).add(this.glow.mul(0.45)),
    );
  }
  update(target: Vector3, worldRadius: number, delta: number) {
    this.camera.getWorldDirection(this.direction);
    const depth = Math.max(
      this.offset.copy(target).sub(this.camera.position).dot(this.direction),
      1,
    );
    this.focusDistance.value += (depth - this.focusDistance.value) * (1 - Math.exp(-delta * 12));
    if (delta === 0) this.focusDistance.value = depth;
    this.projected.copy(target).project(this.camera);
    this.center.value.set(this.projected.x * 0.5 + 0.5, 0.5 - this.projected.y * 0.5);
    const halfHeight = depth * Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    this.radius.value = (worldRadius / halfHeight) * 0.5;
    this.aspect.value = this.camera.aspect;
    // Keep the blur radius stable in CSS pixels as device density/adaptive quality changes.
    this.blurRadius.value = this.renderer.getPixelRatio() * (this.camera.aspect < 1 ? 0.55 : 0.9);
  }
  render() {
    this.pipeline.render();
  }
  dispose() {
    this.blur.dispose();
    this.glow.dispose();
    this.scenePass.dispose();
    this.pipeline.dispose();
  }
}
