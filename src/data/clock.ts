import type { DayPhase, DayPreset } from '@/types/factory';

// Framework-free clock helpers shared by the renderer, the React overlay, and tests.

/** City minutes that pass per real second at 1x speed. */
export const CITY_MINUTES_PER_SECOND = 2.5;
export const CLOCK_SPEEDS = [1, 4, 12] as const;
export const DEFAULT_SPEED = 4;
/** Late afternoon, so the first minute of a visit runs through golden hour into dusk. */
export const START_HOURS = 16.5;
export const PRESET_HOURS: Record<DayPreset, number> = { day: 12, dusk: 18.25, night: 22 };

export const wrapHours = (hours: number) => ((hours % 24) + 24) % 24;
/** Forward distance in hours, so preset jumps always move the clock ahead. */
export const hoursUntil = (from: number, to: number) => wrapHours(to - from);

export function phaseAt(hours: number): DayPhase {
  const h = wrapHours(hours);
  if (h >= 5 && h < 7.5) return 'dawn';
  if (h >= 7.5 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

export function formatClock(hours: number) {
  const total = Math.floor(wrapHours(hours) * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const nextSpeed = (speed: number) =>
  CLOCK_SPEEDS[
    (CLOCK_SPEEDS.indexOf(speed as (typeof CLOCK_SPEEDS)[number]) + 1) % CLOCK_SPEEDS.length
  ];
