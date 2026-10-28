import { blockKeyAt } from './layout';

export interface QueueSite {
  x: number;
  z: number;
  /** World z of the front edge of the building's plinth. */
  front: number;
  /** World position of the lit ground-floor entrance the line walks into. */
  door: QueuePoint;
  /** Share of the busiest district's traffic, 0 to 1. It sets how many visitors turn up. */
  load: number;
  color: string;
  /** This district keeps a guide standing on its plaza, outside the queue. */
  host?: boolean;
}
export interface QueuePoint {
  x: number;
  z: number;
}
export interface QueueLayout {
  key: number;
  /** From the house entrance to the open sidewalk entrance at the back of the line. */
  path: QueuePoint[];
  rails: [QueuePoint, QueuePoint][];
  length: number;
  /** The lit entrance the head of the line stands at. */
  door: QueuePoint;
  /** How far the front visitor walks from the threshold to standing behind the glass. */
  inside: number;
  /** Slots a full line holds. Measured without the door offset, so every lot compares equally. */
  capacity: number;
  /** 1 when the serpentine runs its rows to the left of the door, -1 when it is mirrored. */
  side: 1 | -1;
  /** The site's share of the busiest district's traffic, 0 to 1. */
  load: number;
}

/** Dense enough to read as a busy line while leaving a small gap between enlarged visitors. */
export const QUEUE_SPACING = 0.34;
export const QUEUE_ARRIVAL_DISTANCE = 0.9;
export const QUEUE_INSIDE_DISTANCE = 0.55;
/** How far behind the doorway glass a visitor stands once they are indoors. */
export const INSIDE_CLEARANCE = 0.3;
/** One queue exchange happens every half-second: one person enters and one runner returns. */
export const QUEUE_STEP_SECONDS = 0.5;
/** Number of people running around the busiest building before they rejoin its queue. */
export const RUNNERS_PER_QUEUE = 18;
/** Even the quietest shop keeps a line worth looking at, and enough runners to read as a loop. */
export const MIN_QUEUE_SLOTS = 10;
export const MIN_RUNNERS = 7;

/**
 * The waiting line fills from the doorway backwards, so a busier district's queue reaches further.
 * The share is taken of the door-independent capacity, never of this lot's own path: mirroring
 * only ever makes a path longer, so the line always fits and no frontage can skew the ranking.
 */
export function queueSlotCount(layout: QueueLayout) {
  return Math.max(MIN_QUEUE_SLOTS, Math.round(layout.capacity * layout.load));
}
export function runnerCount(layout: QueueLayout) {
  return Math.max(MIN_RUNNERS, Math.round(RUNNERS_PER_QUEUE * layout.load));
}

/** Track 0 is the doorway, followed by queue slots, then the runner circuit and one occupied indoor slot. */
export function queueTrackIndex(
  person: number,
  elapsed: number,
  slots: number,
  runners = RUNNERS_PER_QUEUE,
) {
  const total = slots + runners + 1;
  return (((person - Math.floor(elapsed / QUEUE_STEP_SECONDS)) % total) + total) % total;
}

/**
 * One compact serpentine queue, head at the house's own doorway. People and rope barriers use this
 * same layout. The doorway is rarely in the middle of the frontage, so the whole serpentine is
 * mirrored to run its rows away from it: that keeps the first row full length on either side, and
 * the line's length then only ever reflects how busy the district is.
 */
export function createQueueLayout(site: QueueSite): QueueLayout {
  const offset = Math.max(-1.72, Math.min(1.72, site.door.x - site.x));
  const side = offset < 0 ? -1 : 1;
  const door = Math.abs(offset);
  const point = (x: number, z: number) => ({ x: site.x + side * x, z: site.front + z });
  const path = [
    point(door, 0.04),
    point(door, 0.4),
    point(-1.72, 0.4),
    point(-1.72, 0.96),
    point(1.72, 0.96),
    point(1.72, 1.52),
    point(-1.72, 1.52),
    point(-2.35, 1.52),
  ];
  // Alternating end gaps join the three rows.
  const rails: [QueuePoint, QueuePoint][] = [
    [point(-1.4, 0.68), point(1.96, 0.68)],
    [point(-1.96, 1.24), point(1.4, 1.24)],
    [point(-1.96, 1.8), point(1.96, 1.8)],
    // Open the right end of the first row for visitors running out of the house.
    [point(1.96, 0.68), point(1.96, 1.8)],
    // Leave the last row open on the left for arriving visitors.
    [point(-1.96, 0.12), point(-1.96, 1.24)],
  ];
  // The rope along the shopfront stops short of the doorway the line feeds into.
  rails.unshift([point(-1.96, 0.12), point(door - 0.3, 0.12)]);
  let length = 0;
  for (let i = 1; i < path.length; i++)
    length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  // A recessed door sits well behind the plinth edge, so the walk in has to be that much longer.
  const entrance = { x: path[0].x, z: site.door.z };
  const inside = Math.max(QUEUE_INSIDE_DISTANCE, path[0].z - entrance.z + INSIDE_CLEARANCE);
  // Only the first row grows with the door offset, so removing it gives the shared capacity.
  const capacity = Math.floor((length - door + QUEUE_ARRIVAL_DISTANCE) / QUEUE_SPACING);
  return {
    key: blockKeyAt(site.x, site.z),
    path,
    rails,
    length,
    door: entrance,
    inside,
    capacity,
    side,
    load: site.load,
  };
}

/**
 * The last few steps: from the threshold at the head of the line, through the lit doorway and a
 * stride past the glass. `travel` runs from 0 at the head of the line to `layout.inside` indoors.
 */
export function sampleQueueEntry(
  layout: QueueLayout,
  travel: number,
  out: QueuePoint & { heading: number },
) {
  const head = layout.path[0];
  const dx = layout.door.x - head.x,
    dz = layout.door.z - head.z;
  const span = Math.hypot(dx, dz);
  // A door straight ahead of the line leaves no direction to read, so walk into the building.
  const ux = span > 1e-4 ? dx / span : 0,
    uz = span > 1e-4 ? dz / span : -1;
  const distance = Math.max(0, Math.min(layout.inside, travel));
  out.x = head.x + ux * distance;
  out.z = head.z + uz * distance;
  out.heading = Math.atan2(ux, uz);
  return out;
}

/** Distance back from the door, facing the person ahead in the queue. */
export function sampleQueue(
  layout: QueueLayout,
  distance: number,
  out: QueuePoint & { heading: number },
) {
  let remaining = Math.max(0, Math.min(layout.length, distance));
  for (let i = 1; i < layout.path.length; i++) {
    const a = layout.path[i - 1],
      b = layout.path[i];
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (remaining <= length || i === layout.path.length - 1) {
      const t = remaining / length;
      out.x = a.x + dx * t;
      out.z = a.z + dz * t;
      out.heading = Math.atan2(-dx, -dz);
      return out;
    }
    remaining -= length;
  }
  return out;
}

/**
 * A continuous visitor loop. People approach the open back of the queue, follow every turn,
 * then pass through the front doorway before reappearing as a new arrival.
 */
export function sampleQueueFlow(
  layout: QueueLayout,
  travelled: number,
  out: QueuePoint & { heading: number },
) {
  const cycle = layout.length + QUEUE_ARRIVAL_DISTANCE + layout.inside;
  const phase = ((travelled % cycle) + cycle) % cycle;
  const distance = layout.length + QUEUE_ARRIVAL_DISTANCE - phase;
  if (distance >= 0 && distance <= layout.length) return sampleQueue(layout, distance, out);

  if (distance > layout.length) {
    const b = layout.path.at(-1)!,
      a = layout.path.at(-2)!;
    const dx = b.x - a.x,
      dz = b.z - a.z,
      length = Math.hypot(dx, dz),
      extra = distance - layout.length;
    out.x = b.x + (dx / length) * extra;
    out.z = b.z + (dz / length) * extra;
    out.heading = Math.atan2(-dx, -dz);
    return out;
  }

  return sampleQueueEntry(layout, -distance, out);
}
