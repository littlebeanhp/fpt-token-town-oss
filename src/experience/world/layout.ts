/**
 * City grid shared by the city builder, crowds, camera tests, and focus emphasis.
 * Roads run between blocks; each block holds one raised sidewalk lot.
 */
export const BLOCK_PITCH = 10;
export const ROAD_WIDTH = 2.2;
export const LOT_SIZE = BLOCK_PITCH - ROAD_WIDTH;
export const LOT_HALF = LOT_SIZE / 2;
export const SIDEWALK_HEIGHT = 0.14;
/** Filler blocks extend this many blocks from the centre in every direction. */
export const CITY_BLOCKS = 4;
/** Half-width of the built-up city; the distant edge is hidden by camera-relative fog. */
export const CITY_EXTENT = (CITY_BLOCKS + 0.5) * BLOCK_PITCH;
export const FOG_NEAR_OFFSET = 8;
export const FOG_FAR_OFFSET = 24;
/** Detailed streets and lamps only surround the tour districts. */
export const STREET_BLOCKS = 2;
/** Two front corners and two side lanterns; the two far/rear corners stay open. */
export const LAMP_HEAD_HEIGHT = 1.65;
const LAMP_INSET = LOT_HALF - 0.3;
export const LAMP_OFFSETS: readonly (readonly [number, number])[] = [
  [-LAMP_INSET, LAMP_INSET],
  [LAMP_INSET, LAMP_INSET],
  [-LAMP_INSET, 0],
  [LAMP_INSET, 0],
];
/** The central 3x3 blocks hold the core, the six districts, and two parks. */
const DISTRICT_RANGE = 1;
const PARK_BLOCKS: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
];

/**
 * Blocks the locked camera can never frame, so nothing is built on them. Every shot stands in
 * the front half of the city looking inward, which leaves the +X column and the +Z row behind
 * the lens, and camera-relative fog swallows the far corners on that side before they enter a
 * frustum. `tests/city-sight.test.ts` re-derives this from the camera itself, with a three-unit
 * margin around each lot and eight units of fog slack, and fails if a shot ever reaches one.
 */
export function isBlockInSight(i: number, j: number) {
  if (i > CITY_BLOCKS - 1 || j > CITY_BLOCKS - 1) return false;
  // The two far corners on the camera's own side of the city.
  if (i === CITY_BLOCKS - 1 && j > CITY_BLOCKS - 2) return false;
  if (j === CITY_BLOCKS - 1 && i < -CITY_BLOCKS + 2) return false;
  // The far -X column sits behind the left-hand shots once they turn inward.
  return !(i === -CITY_BLOCKS && j > 1);
}

export const blockIndex = (coordinate: number) => Math.round(coordinate / BLOCK_PITCH);
export const blockKey = (i: number, j: number) => (i + 64) * 128 + (j + 64);
export const blockKeyAt = (x: number, z: number) => blockKey(blockIndex(x), blockIndex(z));
export const isDistrictBlock = (i: number, j: number) =>
  Math.abs(i) <= DISTRICT_RANGE && Math.abs(j) <= DISTRICT_RANGE;
export const isParkBlock = (i: number, j: number) =>
  PARK_BLOCKS.some(([pi, pj]) => pi === i && pj === j);

/** Small deterministic PRNG so the city is identical on every load and in tests. */
export function createRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Right-hand lanes loop clockwise around each block, with rounded intersection turns. */
export const TRAFFIC_LANE_HALF = BLOCK_PITCH / 2 - ROAD_WIDTH / 4;
export const TRAFFIC_TURN_RADIUS = 0.6;
const TRAFFIC_STRAIGHT = 2 * (TRAFFIC_LANE_HALF - TRAFFIC_TURN_RADIUS);
const TRAFFIC_CORNER = (Math.PI * TRAFFIC_TURN_RADIUS) / 2;
export const TRAFFIC_LOOP_LENGTH = 4 * (TRAFFIC_STRAIGHT + TRAFFIC_CORNER);

export interface TrafficLane {
  readonly x: number;
  readonly z: number;
  readonly key: number;
}
export interface LanePose {
  x: number;
  z: number;
  heading: number;
}
export const TRAFFIC_LANES: readonly TrafficLane[] = Array.from({ length: 49 }, (_, index) => {
  const i = (index % 7) - 3;
  const j = Math.floor(index / 7) - 3;
  return { x: i * BLOCK_PITCH, z: j * BLOCK_PITCH, key: blockKey(i, j) };
});

/** Arc-length sampling into a caller-owned pose: constant speed, continuous loop and heading. */
export function sampleTrafficLane(lane: TrafficLane, distance: number, out: LanePose) {
  const wrapped = ((distance % TRAFFIC_LOOP_LENGTH) + TRAFFIC_LOOP_LENGTH) % TRAFFIC_LOOP_LENGTH;
  const sideLength = TRAFFIC_STRAIGHT + TRAFFIC_CORNER;
  const side = Math.floor(wrapped / sideLength);
  const along = wrapped - side * sideLength;
  const inner = TRAFFIC_LANE_HALF - TRAFFIC_TURN_RADIUS;
  let x: number, z: number, heading: number;
  if (along < TRAFFIC_STRAIGHT) {
    x = inner - along;
    z = TRAFFIC_LANE_HALF;
    heading = -Math.PI / 2;
  } else {
    const angle = (along - TRAFFIC_STRAIGHT) / TRAFFIC_TURN_RADIUS;
    x = -inner - Math.sin(angle) * TRAFFIC_TURN_RADIUS;
    z = inner + Math.cos(angle) * TRAFFIC_TURN_RADIUS;
    heading = -Math.PI / 2 - angle;
  }
  // Rotate successive sides by 90 degrees in the ground plane.
  if (side === 0) {
    out.x = lane.x + x;
    out.z = lane.z + z;
  } else if (side === 1) {
    out.x = lane.x - z;
    out.z = lane.z + x;
  } else if (side === 2) {
    out.x = lane.x - x;
    out.z = lane.z - z;
  } else {
    out.x = lane.x + z;
    out.z = lane.z - x;
  }
  out.heading = heading - (side * Math.PI) / 2;
  return out;
}
