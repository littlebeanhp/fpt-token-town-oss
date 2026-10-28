/** Limit GPU pixels independently of CSS layout; phones retain sharp HTML overlays. */
export function renderPixelRatio(deviceRatio: number, width: number, height: number, scale = 1) {
  const cap = width <= 700 ? 1.25 : 1.5;
  const pixelBudget = Math.sqrt(1_500_000 / Math.max(width * height, 1));
  return Math.min(deviceRatio, cap, pixelBudget) * scale;
}

/** Slow, bounded adjustments prevent resolution oscillation. Ignore isolated startup/tab stalls. */
export class AdaptiveResolution {
  scale = 1;
  private frames = 0;
  private seconds = 0;
  private fastWindows = 0;
  sample(delta: number) {
    if (delta <= 0 || delta > 0.25) return false;
    this.frames++;
    this.seconds += delta;
    if (this.frames < 90) return false;
    const average = this.seconds / this.frames;
    this.frames = 0;
    this.seconds = 0;
    const before = this.scale;
    if (average > 1 / 40) {
      this.scale = Math.max(0.65, this.scale - 0.15);
      this.fastWindows = 0;
    } else if (average < 1 / 55) {
      if (++this.fastWindows >= 3) {
        this.scale = Math.min(1, this.scale + 0.1);
        this.fastWindows = 0;
      }
    } else this.fastWindows = 0;
    return this.scale !== before;
  }
  reset() {
    this.frames = 0;
    this.seconds = 0;
    this.fastWindows = 0;
  }
}
