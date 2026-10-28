import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three/webgpu';
import { gsap } from 'gsap';
import { BLOCK_PITCH, blockIndex } from '../world/layout';

const SHOT_FOV = 30;
/** Minimum framed radius: the building plus its front plaza and visitor queue. */
const DISTRICT_RADIUS = 4.4;
const SHOT_POLAR = MathUtils.degToRad(52);
/** Camera sits front-right of a stop; the left column mirrors it so it still looks inward. */
const SHOT_AZIMUTH = MathUtils.degToRad(28);
/** How much of the frame the district's radius fills on its tighter axis. */
const FILL = 1.12;
/** Bring locked shots 25% closer so districts and their visitors dominate over the roads. */
export const SHOT_ZOOM = 1.25;
const TRANSITION_SECONDS = 1.45;

/** A locked camera stop: where to look and how much of the city block to frame. */
export interface Shot {
  target: Vector3;
  /** World radius around the target that must stay in frame. */
  radius: number;
  /** -1 for the left column, 0 for the centre, 1 for the right. */
  side: number;
}

const sideForX = (x: number) => (x < -1 ? -1 : x > 1 ? 1 : 0);

/**
 * Shot for a building at `position`. It frames the whole block (building, plaza, and queue)
 * at a height derived from the asset's CameraTarget anchor.
 */
export function createShot(
  position: readonly [number, number, number],
  anchorHeight: number,
  boundsRadius: number,
): Shot {
  const [x, , z] = position;
  return {
    target: new Vector3(x, anchorHeight * 0.8, blockIndex(z) * BLOCK_PITCH + 0.2),
    radius: Math.max(DISTRICT_RADIUS, boundsRadius + 0.8),
    side: sideForX(x),
  };
}

/**
 * Lens shift that keeps the subject clear of the overlays: right of the desktop panel, and
 * below the hero text on tall phone canvases.
 */
function framing(width: number, height: number) {
  const shiftX = width > 900 ? Math.min(width * 0.1, 170) : 0;
  const shiftY = width <= 700 && height > width * 1.25 ? -height * 0.1 : 0;
  const safeHeight = Math.max(height, 1);
  // Usable half-extents of the view, relative to the full frame height.
  return {
    shiftX,
    shiftY,
    fit: {
      x: Math.max(width - shiftX * 2, 1) / safeHeight,
      y: (safeHeight - Math.abs(shiftY) * 2) / safeHeight,
    },
  };
}
type Fit = ReturnType<typeof framing>['fit'];

/**
 * Art-directed orbit for a stop. Corner and side districts turn the camera toward the city
 * centre, so the far part of every frame looks across the city instead of past its edge.
 */
function shotSpherical(shot: Shot, fit: Fit, out: Spherical) {
  const halfTangent = Math.tan(MathUtils.degToRad(SHOT_FOV / 2));
  const halfVertical = Math.atan(halfTangent * fit.y);
  const halfHorizontal = Math.atan(halfTangent * fit.x);
  out.radius =
    (shot.radius * FILL) / (SHOT_ZOOM * Math.sin(Math.min(halfVertical, halfHorizontal)));
  out.phi = SHOT_POLAR;
  out.theta = shot.side < 0 ? -SHOT_AZIMUTH : SHOT_AZIMUTH;
  return out;
}

/** Camera pose part-way between two stops, with a gentle lift that reveals the route. */
function interpolatePose(
  fromTarget: Vector3,
  from: Spherical,
  toTarget: Vector3,
  to: Spherical,
  progress: number,
  outTarget: Vector3,
  out: Spherical,
) {
  const lift = Math.min(0.16, fromTarget.distanceTo(toTarget) / 90);
  outTarget.lerpVectors(fromTarget, toTarget, progress);
  out.radius =
    MathUtils.lerp(from.radius, to.radius, progress) * (1 + lift * Math.sin(Math.PI * progress));
  out.phi = MathUtils.lerp(from.phi, to.phi, progress);
  out.theta = MathUtils.lerp(from.theta, to.theta, progress);
  return out;
}

/**
 * Locked city camera. Users move between stops with Next/Previous; there is no free orbit,
 * pan, or zoom, so the view can never leave the built-up city.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(SHOT_FOV, 1, 0.5, 420);
  readonly target = new Vector3();
  private spherical = new Spherical(24, SHOT_POLAR, SHOT_AZIMUTH);
  private shot: Shot | null = null;
  private tween?: gsap.core.Tween;
  private fit: Fit = { x: 1, y: 1 };
  private fromTarget = new Vector3();
  private fromSpherical = new Spherical();
  private toSpherical = new Spherical();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private orbitOffset = 0;
  orbitBy(delta: number) {
    if (!this.shot || this.transitioning) return;
    this.orbitOffset = MathUtils.clamp(this.orbitOffset + delta, -Math.PI / 12, Math.PI / 12);
    shotSpherical(this.shot, this.fit, this.spherical);
    this.spherical.theta += this.orbitOffset;
    this.canvas.dataset.orbit = String(this.orbitOffset);
    this.apply();
  }
  constructor(private canvas: HTMLCanvasElement) {
    this.canvas.dataset.transition = 'idle';
    this.apply();
  }
  get distance() {
    return this.spherical.radius;
  }
  get transitioning() {
    return this.canvas.dataset.transition === 'active';
  }
  resize(width: number, height: number) {
    const { shiftX, shiftY, fit } = framing(width, height);
    this.fit = fit;
    this.camera.aspect = width / height;
    this.camera.setViewOffset(width, height, -shiftX, -shiftY, width, height);
    this.camera.updateProjectionMatrix();
    // Mid-transition resizes are picked up by the tween, which refits every frame.
    if (this.shot && !this.transitioning) {
      shotSpherical(this.shot, this.fit, this.spherical);
      this.spherical.theta += this.orbitOffset;
      this.apply();
    }
  }
  focus(shot: Shot, immediate = false) {
    this.tween?.kill();
    const from = this.shot;
    this.shot = shot;
    this.fromTarget.copy(this.target);
    this.fromSpherical.copy(this.spherical);
    this.orbitOffset = 0;
    this.canvas.dataset.orbit = '0';
    if (!from) immediate = true;
    this.canvas.dataset.transition = 'active';
    const state = { progress: 0 };
    this.tween = gsap.to(state, {
      progress: 1,
      duration: immediate || this.reduced ? 0 : TRANSITION_SECONDS,
      ease: 'power3.inOut',
      onUpdate: () => this.poseBetween(this.fromTarget, this.fromSpherical, shot, state.progress),
      onComplete: () => {
        this.poseBetween(this.fromTarget, this.fromSpherical, shot, 1);
        this.canvas.dataset.transition = 'idle';
      },
    });
  }
  /** Places the camera part-way from a pose to a shot. Also used by the framing tests. */
  poseBetween(fromTarget: Vector3, from: Spherical, shot: Shot, progress: number) {
    shotSpherical(shot, this.fit, this.toSpherical);
    interpolatePose(
      fromTarget,
      from,
      shot.target,
      this.toSpherical,
      progress,
      this.target,
      this.spherical,
    );
    this.apply();
  }
  private apply() {
    this.camera.position.setFromSpherical(this.spherical).add(this.target);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
  dispose() {
    this.tween?.kill();
  }
}
