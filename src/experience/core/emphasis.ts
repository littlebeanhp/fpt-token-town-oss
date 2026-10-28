import type { Color } from 'three/webgpu';

/** Emphasis of everything outside the focused district. 1 is the focused district. */
export const BACKGROUND_EMPHASIS = 0.28;

/**
 * Shared focus treatment: background colors move to their own luminance gray and darken
 * slightly. Opacity is never used, so depth sorting and shadows stay correct.
 */
export function tintForEmphasis(r: number, g: number, b: number, emphasis: number, out: Color) {
  const gray = r * 0.2126 + g * 0.7152 + b * 0.0722;
  // Fully gray at background emphasis; the focused district keeps its exact colors.
  const desaturate = Math.min(1, Math.max(0, (1 - emphasis) / (1 - BACKGROUND_EMPHASIS)));
  const brightness = 0.7 + emphasis * 0.3;
  return out.setRGB(
    (r + (gray - r) * desaturate) * brightness,
    (g + (gray - g) * desaturate) * brightness,
    (b + (gray - b) * desaturate) * brightness,
  );
}
