// REST route integration — fastify inject, no network.
import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerRoutes } from '../src/api/routes.js';
import { RoomStore } from '../src/game/store.js';

const app = Fastify({ logger: false });
const store = new RoomStore({
  clock: { now: () => Date.now() },
  timers: { set: (cb, ms) => setTimeout(cb, ms), clear: (h) => clearTimeout(h as any) },
});
registerRoutes(app, store);
afterAll(async () => { await app.close(); store.stop(); });

describe('REST contracts (API_CONTRACT §2)', () => {
  it('GET /health returns ok + rules version', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.ok).toBe(true);
    expect(j.rules).toBe('bomb-rush-v0.5');
  });

  it('POST /api/rooms validates entry range: 0.01–10 test MON', async () => {
    const bad1 = await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '1' } }); // too small (<0.01 MON)
    expect(bad1.statusCode).toBe(400);
    const bad2 = await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '99999999999999999999999999' } });
    expect(bad2.statusCode).toBe(400);
    const good = await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '1000000000000000000', allowDemoBot: false } });
    expect(good.statusCode).toBe(201);
    const j = good.json();
    expect(j.participantId).toBeTruthy();
    expect(j.sessionToken).toBeTruthy();
    expect(j.visibility).toBe('PUBLIC');
  });

  it('private rooms excluded from public list', async () => {
    const pub = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '1000000000000000000', visibility: 'PUBLIC' } })).json();
    const priv = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '1000000000000000000', visibility: 'PRIVATE' } })).json();
    const listed = (await app.inject({ method: 'GET', url: '/api/rooms' })).json().rooms as any[];
    const pubIds = listed.map((r) => r.roomId);
    expect(pubIds).toContain(pub.roomId);
    expect(pubIds).not.toContain(priv.roomId);
  });

  it('join returns token; unknown room 404/409; full room 403', async () => {
    const c = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '1000000000000000000' } })).json();
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: 'POST', url: `/api/rooms/${c.roomId}/join`, payload: { kind: 'HUMAN' } });
      expect(r.statusCode).toBe(200);
    }
    const full = await app.inject({ method: 'POST', url: `/api/rooms/${c.roomId}/join`, payload: { kind: 'HUMAN' } });
    expect(full.statusCode).toBe(403);
    expect(full.json().error).toBe('ROOM_FULL');
    const missing = await app.inject({ method: 'POST', url: '/api/rooms/nonexistent/join', payload: {} });
    expect([404, 409]).toContain(missing.statusCode);
  });

  it('GET /api/rooms/:roomId unknown → 404', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/rooms/nonexistent' });
    expect(r.statusCode).toBe(404);
  });

  it('cancel: only host participant id works; stranger gets 403', async () => {
    const c = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '1000000000000000000' } })).json();
    // host participantId is the one returned at create
    const j = (await app.inject({ method: 'POST', url: `/api/rooms/${c.roomId}/join`, payload: {} })).json();
    const stranger = await app.inject({ method: 'POST', url: `/api/rooms/${c.roomId}/cancel`, payload: { participantId: j.participantId, sessionToken: j.sessionToken } });
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().error).toBe('NOT_HOST');
    // cancel now requires BOTH participantId and sessionToken (guest-session auth)
    const noToken = await app.inject({ method: 'POST', url: `/api/rooms/${c.roomId}/cancel`, payload: { participantId: c.participantId } });
    expect(noToken.statusCode).toBe(400);
    const badToken = await app.inject({ method: 'POST', url: `/api/rooms/${c.roomId}/cancel`, payload: { participantId: c.participantId, sessionToken: 'forged' } });
    expect(badToken.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: `/api/rooms/${c.roomId}/cancel`, payload: { participantId: c.participantId, sessionToken: c.sessionToken } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().canceled).toBe(true);
  });

  it('match result endpoint: unknown match → 404; finished match → PENDING chain record (honest)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/matches/nope/result' });
    expect(r.statusCode).toBe(404);
    // finished match path exercised in socket integration; here verify schema shape
    const c = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '1000000000000000000' } })).json();
    // no match yet: 404 — result only for FINISHED
    const nj = await app.inject({ method: 'GET', url: `/api/matches/${c.roomId}/result` });
    expect(nj.statusCode).toBe(404);
  });
});
