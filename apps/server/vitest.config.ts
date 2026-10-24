import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 15s lobby countdown + sequential game ticks make wall-clock tests slow;
    // all time-dependent logic uses the injected Clock in src/sim/domain.ts
    // so tests use fake clocks instead of real waits.
    testTimeout: 15_000,
  },
});
