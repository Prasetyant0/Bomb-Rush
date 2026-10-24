import { vi } from 'vitest';

export function makeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

export function makeManualClock(start = 1_000_000) {
  const clock = makeClock(start);
  return { ...clock };
}

/** Fake timers pre-configured for our tests (vi.useFakeTimers shim). */
export function setupFakeTimers() {
  vi.useFakeTimers();
}
