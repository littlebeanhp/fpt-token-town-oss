import { CurvePath, LineCurve3, QuadraticBezierCurve3, Vector3 } from 'three/webgpu';
import { BLOCK_PITCH, LOT_HALF, SIDEWALK_HEIGHT, blockIndex } from '../world/layout';

/** Reserved public square, independent of the DeepSeek home/camera stop. */
export const TOKEN_PLAZA = { x: -10, z: 0 };
export const isTokenPlaza = (i: number, j: number) =>
  i * BLOCK_PITCH === TOKEN_PLAZA.x && j * BLOCK_PITCH === TOKEN_PLAZA.z;

/** Follow street centres with rounded elbows; both ends plug into the sidewalk rim. */
export function tokenRoute(position: readonly number[], index: number, direction: number) {
  const x = blockIndex(position[0]) * BLOCK_PITCH;
  const z = blockIndex(position[2]) * BLOCK_PITCH;
  const lane = direction * 0.16;
  const portX = x + direction * 0.3;
  const sourceX = TOKEN_PLAZA.x - 2.7 + index * 0.85 + lane;
  const height = SIDEWALK_HEIGHT + 0.05;
  const streetZ = TOKEN_PLAZA.z + BLOCK_PITCH / 2 + lane;
  const targetZ = z + BLOCK_PITCH / 2 + lane;
  const points = [
    new Vector3(sourceX, height, TOKEN_PLAZA.z + LOT_HALF),
    new Vector3(sourceX, 1.9, streetZ),
  ];
  if (z !== TOKEN_PLAZA.z) {
    const trunkX = TOKEN_PLAZA.x + BLOCK_PITCH / 2 + lane;
    points.push(new Vector3(trunkX, 1.9, streetZ), new Vector3(trunkX, 1.9, targetZ));
  }
  points.push(new Vector3(portX, 1.9, targetZ), new Vector3(portX, height, z + LOT_HALF));
  const curve = new CurvePath<Vector3>();
  let previous = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const corner = points[i];
    const radius = Math.min(
      0.24,
      corner.distanceTo(points[i - 1]) / 3,
      corner.distanceTo(points[i + 1]) / 3,
    );
    const before = corner
      .clone()
      .addScaledVector(points[i - 1].clone().sub(corner).normalize(), radius);
    const after = corner
      .clone()
      .addScaledVector(points[i + 1].clone().sub(corner).normalize(), radius);
    curve.add(new LineCurve3(previous, before));
    curve.add(new QuadraticBezierCurve3(before, corner, after));
    previous = after;
  }
  curve.add(new LineCurve3(previous, points.at(-1)!));
  return curve;
}
