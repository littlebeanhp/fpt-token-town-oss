import { Color, MathUtils, Vector3 } from 'three/webgpu';
import { CITY_MINUTES_PER_SECOND, DEFAULT_SPEED, START_HOURS, wrapHours } from '@/data/clock';

/** Accelerated city time. It only advances when the render loop feeds it frame deltas. */
export class CityClock {
  hours: number;
  paused: boolean;
  speed: number = DEFAULT_SPEED;
  constructor(hours = START_HOURS, paused = false) {
    this.hours = wrapHours(hours);
    this.paused = paused;
  }
  advance(seconds: number) {
    if (this.paused || seconds <= 0) return;
    this.hours = wrapHours(this.hours + (seconds * this.speed * CITY_MINUTES_PER_SECOND) / 60);
  }
}

export interface LightingSample {
  /** Unit vector from the scene toward the key light (sun by day, moon by night). */
  lightDirection: Vector3;
  lightIntensity: number;
  lightColor: Color;
  sky: Color;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  /** 0 in full daylight, 1 at night. Drives emissive windows, lamps, and tokens. */
  night: number;
}

export const createLightingSample = (): LightingSample => ({
  lightDirection: new Vector3(0, 1, 0),
  lightIntensity: 0,
  lightColor: new Color(),
  sky: new Color(),
  hemiSky: new Color(),
  hemiGround: new Color(),
  hemiIntensity: 0,
  night: 0,
});

interface Key {
  hours: number;
  sky: Color;
  light: Color;
  hemiSky: Color;
  hemiGround: Color;
  hemi: number;
}
const key = (
  hours: number,
  sky: string,
  light: string,
  hemiSky: string,
  hemiGround: string,
  hemi: number,
): Key => ({
  hours,
  sky: new Color(sky),
  light: new Color(light),
  hemiSky: new Color(hemiSky),
  hemiGround: new Color(hemiGround),
  hemi,
});
// Art-directed keyframes: night, dawn, day, golden hour, dusk, blue hour, night.
const keys: Key[] = [
  key(0, '#132631', '#9fc0ff', '#3f5d78', '#1b2b30', 0.75),
  key(4.8, '#152833', '#a5c4ff', '#43617c', '#1d2d32', 0.75),
  key(6, '#d6b8a8', '#ffb27a', '#efd6c8', '#7d7a80', 1.6),
  key(7.6, '#e2ebe8', '#fff0d8', '#e6f3ff', '#92a29a', 2.4),
  key(12, '#e7ede9', '#fff4dc', '#e6f6ff', '#92a29a', 2.6),
  key(16.4, '#e8e4da', '#ffe2b8', '#f2e9dc', '#9a9a8c', 2.3),
  key(18, '#c4937f', '#ff9a5c', '#dba892', '#5f5767', 1.45),
  key(19.1, '#3c4f68', '#8fa9d6', '#56688a', '#2a3040', 0.95),
  key(20.5, '#172b32', '#b2d6ff', '#3d5c73', '#1c2c30', 0.8),
  key(24, '#132631', '#9fc0ff', '#3f5d78', '#1b2b30', 0.75),
];

/** Fills `out` with the lighting for a time of day. Pure and allocation-free. */
export function sampleLighting(hours: number, out: LightingSample) {
  const h = wrapHours(hours);
  let index = 0;
  while (index < keys.length - 2 && h >= keys[index + 1].hours) index++;
  const a = keys[index],
    b = keys[index + 1];
  const t = MathUtils.smoothstep(h, a.hours, b.hours);
  out.sky.copy(a.sky).lerp(b.sky, t);
  out.lightColor.copy(a.light).lerp(b.light, t);
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
  // A modest sky/ground fill preserves the contrast of direct lighting and shadows.
  // Retain daytime contrast, with more sky fill in dim evening/night keyframes.
  const hemi = MathUtils.lerp(a.hemi, b.hemi, t);
  out.hemiIntensity = hemi * MathUtils.lerp(0.65, 0.25, MathUtils.smoothstep(hemi, 0.8, 2.4));

  // The sun rises in the east (+x) at 06:00 and sets in the west at 18:00. After sunset the
  // same continuous path acts as moonlight, so the light direction never jumps.
  const arc = ((h - 6) / 12) * Math.PI;
  const height = Math.sin(arc);
  out.lightDirection.set(Math.cos(arc) * 0.85, Math.max(Math.abs(height), 0.32), 0.5).normalize();
  const sun = MathUtils.smoothstep(height, -0.02, 0.35) * 3.3;
  const moon = (1 - MathUtils.smoothstep(height, -0.3, 0.05)) * 0.4;
  out.lightIntensity = sun + moon;
  out.night = 1 - MathUtils.smoothstep(height, -0.2, 0.3);
  return out;
}
