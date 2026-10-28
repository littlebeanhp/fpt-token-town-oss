import type { LoadStage } from '@/types/factory';

/**
 * What the loading screen says while the city is assembled. The city reports each chapter as it
 * starts it, and the overlay stays up until the last one finishes, so the tour never opens onto
 * a frame that is still filling in. Districts, props and visitors each arrive in their own
 * chapter, which is also roughly how long each one takes.
 */
export const LOAD_STAGES: { id: LoadStage; label: string; note: string }[] = [
  { id: 'renderer', label: 'Waking up the graphics device', note: 'Checking for WebGPU' },
  {
    id: 'city',
    label: 'Laying out streets and blocks',
    note: 'Sidewalks, lanterns, road markings',
  },
  { id: 'districts', label: 'Rendering model assets', note: 'Seven districts, five houses' },
  { id: 'backdrop', label: 'Planting trees and street props', note: 'Parks, planters and benches' },
  { id: 'crowd', label: 'Opening the doors to visitors', note: 'Queues, riders and traffic' },
  { id: 'shaders', label: 'Bringing you Token Town', note: 'Compiling shaders' },
];

export const stageIndex = (stage: LoadStage) => LOAD_STAGES.findIndex((item) => item.id === stage);
/** Share of the startup a chapter has reached once it begins; the last one lands just short of full. */
export const stageProgress = (stage: LoadStage | null) =>
  stage === null ? 0.04 : (stageIndex(stage) + 1) / (LOAD_STAGES.length + 1);
