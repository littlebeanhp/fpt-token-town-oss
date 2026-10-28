import type { Group } from 'three/webgpu';
import type { FactoryId } from '@/types/factory';

/** CPU and future compute implementations expose the same lifecycle. */
export interface TokenSimulation {
  readonly root: Group;
  update(delta: number, elapsed: number): void;
  setNight(value: number): void;
  /** Focus emphasis for one district's lanes; 1 is focused. */
  setEmphasis(id: FactoryId, value: number): void;
  dispose(): void;
}
