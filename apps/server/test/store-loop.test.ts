// Store loop regression — the authoritative loop must keep re-arming itself.
// Bug found by the E2E frontend smoke test: the store scheduled one 50 ms tick
// at construction and never re-armed, so real servers never completed lobby
// countdowns (unit tests missed it because they drive tickNow() directly).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GAME_RULES } from '@bomb-rush/shared';
import { RoomStore } from '../src/game/store.js';

/** Minimal fake timer: records live handles; advance() fires all pending. */
function fakeTimers() {
  const pending = new Map<number, { cb: () => void; at: number }>();
  let seq = 0;
  let now = 1_000_000;
  const api = {
    set: (cb: () => void, ms: number) => {
      const handle = ++seq;
      pending.set(handle, { cb, at: now + ms });
      return handle;
    },
    clear: (h: unknown) => pending.delete(h as number),
    advance: (ms: number) => {
      // fire due callbacks repeatedly until none are due within the window
      let firedAny = true;
      const end = now + ms;
      while (firedAny) {
        firedAny = false;
        for (const [h, t] of pending) {
          if (t.at <= end) {
            pending.delete(h);
            now = Math.max(now, t.at);
            t.cb();
            firedAny = true;
            break; // re-arm may have been added; restart scan
          }
        }
      }
      now = end;
    },
    now: () => now,
    pendingCount: () => pending.size,
  };
  return api;
}

describe('Store loop re-arms itself (regression)', () => {
  it('at least one timer is always pending after a loop pass', () => {
    const t = fakeTimers();
    const store = new RoomStore({ clock: { now: t.now }, timers: t });
    t.advance(1_000); // fire ticks
    expect(t.pendingCount()).toBeGreaterThanOrEqual(1);
    store.stop();
  });

  it('full lobby room reaches LIVE via real fake-time loop (no tickNow call)', async () => {
    const t = fakeTimers();
    const store = new RoomStore({ clock: { now: t.now }, timers: t });
    const r = store.createRoom('h', '1000000000000000000', false);
    const j1 = store.joinRoom(r.roomId, 'HUMAN');
    const j2 = store.joinRoom(r.roomId, 'HUMAN');
    store.setReady(r.roomId, r.participantId, true);
    store.setReady(r.roomId, j1.participantId!, true);
    store.setReady(r.roomId, j2.participantId!, true);
    expect(store.getRoom(r.roomId)!.roomStatus).toBe('COUNTDOWN');
    // advance well past 15 s countdown WITHOUT ever calling tickNow
    t.advance(GAME_RULES.LOBBY_COUNTDOWN_MS + 5_000);
    expect(store.getRoom(r.roomId)!.roomStatus).toBe('LIVE');
    expect(store.getRoom(r.roomId)!.matchId).toBeTruthy();
    store.stop();
  });

  it('stop() halts the loop (no further ticks)', () => {
    const t = fakeTimers();
    const store = new RoomStore({ clock: { now: t.now }, timers: t });
    store.stop(); // clears the pending handle
    t.advance(5_000);
    expect(t.pendingCount()).toBe(0);
  });
});
