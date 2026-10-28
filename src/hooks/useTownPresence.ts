'use client';
import { useEffect, useState } from 'react';

/** The band the figure wanders inside. */
const FLOOR = 2000;
const CEILING = 3000;
/** How far a single move can carry it, so the number drifts rather than jumps. */
const STEP = 140;
/** How often it moves. */
const INTERVAL_MS = 30_000;

const clamp = (value: number) => Math.min(CEILING, Math.max(FLOOR, Math.round(value)));

/**
 * People in town. Like the queue sizes and the token traffic, this is a simulated figure, not a
 * measured one: it starts somewhere in its band and drifts by a bounded step every half minute,
 * which reads as a busy city without claiming to have counted anybody.
 */
export function useTownPresence() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let current = clamp(FLOOR + Math.random() * (CEILING - FLOOR));
    setCount(current);
    const move = () => {
      current = clamp(current + (Math.random() * 2 - 1) * STEP);
      setCount(current);
    };
    const timer = setInterval(move, INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
  return count;
}
