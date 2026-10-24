// Per-connection rate limiting for sensitive events (Phase C).
// ponytail: token bucket per socketId — 4 players don't need fancier sharding.
export interface RateLimiter {
  canSend(key: string): boolean;
}

export function makeTokenBucket(opts: { eventsPerInterval: number; intervalMs: number; maxBurst: number }) {
  const state = new Map<string, { tokens: number; last: number }>();
  return {
    canSend(key: string): boolean {
      const now = Date.now();
      let bucket = state.get(key);
      if (!bucket) {
        state.set(key, { tokens: opts.maxBurst, last: now });
        bucket = { tokens: opts.maxBurst, last: now };
      }
      // refill
      const elapsed = now - bucket.last;
      if (elapsed > 0) {
        bucket.tokens = Math.min(opts.maxBurst, bucket.tokens + (elapsed / opts.intervalMs) * opts.eventsPerInterval);
        bucket.last = now;
      }
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
  };
}
