'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoadStage } from '@/types/factory';

/**
 * Every chapter holds the screen for at least this long. The city reports some of them in quick
 * succession, and a line nobody can read is worse than a slightly longer wait.
 */
const MIN_STAGE_MS = 520;
/**
 * The overlay covers the stage and swallows clicks, so it can never be the thing standing
 * between someone and the city. If the city has not reported itself ready by now, the wait is
 * over regardless: the tour controls stay disabled until it is, exactly as they did before.
 */
const PATIENCE_MS = 30_000;

/**
 * Paces the loading screen. The city announces chapters as it reaches them and this shows them
 * one at a time, each for long enough to read. The queue only decides which line is on screen:
 * the overlay itself lives until the city is ready, because shader compilation blocks the main
 * thread for seconds at a time and chapters pile up behind it.
 */
export function useLoadingStages(ready: boolean) {
  const [stage, setStage] = useState<LoadStage | null>(null);
  const [finished, setFinished] = useState(false);
  const queue = useRef<LoadStage[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    queue.current = [];
  }, []);

  const advance = useCallback(() => {
    const next = queue.current.shift();
    if (next === undefined) {
      timer.current = null;
      return;
    }
    setStage(next);
    timer.current = setTimeout(advance, MIN_STAGE_MS);
  }, []);

  const push = useCallback(
    (next: LoadStage) => {
      queue.current.push(next);
      if (!timer.current) advance();
    },
    [advance],
  );

  const reset = useCallback(() => {
    stop();
    setStage(null);
    setFinished(false);
  }, [stop]);

  // A ready city ends the wait at once, however many chapters are still queued behind the
  // compile that blocked them, and a city that never reports itself ready ends it anyway.
  useEffect(() => {
    if (ready) {
      stop();
      setFinished(true);
      return;
    }
    const giveUp = setTimeout(() => {
      stop();
      setFinished(true);
    }, PATIENCE_MS);
    return () => clearTimeout(giveUp);
  }, [ready, stop]);

  useEffect(() => () => stop(), [stop]);

  return { stage, push, reset, visible: !finished };
}
