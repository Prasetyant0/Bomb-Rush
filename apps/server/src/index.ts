// Server entrypoint: Fastify HTTP + Socket.IO, graceful shutdown.
// Runs fully local tonight — no Postgres, no Monad testnet, no assets needed.
import Fastify from 'fastify';
import { Server as IOServer } from 'socket.io';
import { attachCors } from './api/cors.js';
import { registerRoutes, type ChainHealth } from './api/routes.js';
import { RoomStore } from './game/store.js';
import { attachSocketHandlers } from './net/socketAdapter.js';
import { SessionRegistry } from './net/sessions.js';
import { chainStatus, getChainConfig } from './chain/index.js';
import { selfCheck } from './chain/escrow.js';
import { defaultEscrowGateway } from './escrow/gateway.js';
import { realSettlementChain } from './escrow/settlement.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });
attachCors(app);

// Chain is optional. Disabled = the game still runs, with no escrow and no
// settlement. Logged once at boot so the demo operator knows which mode it is.
const chain = getChainConfig();
const status = chainStatus();
if (chain.enabled) {
  app.log.info({ detail: status.detail }, 'chain module enabled');
} else {
  app.log.warn({ reason: status.detail }, 'chain module DISABLED — running in demo mode, no settlement');
}

const systemClock = { now: () => Date.now() };
const systemTimers = { set: (cb: () => void, ms: number) => setTimeout(cb, ms), clear: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };
const store = new RoomStore({
  clock: systemClock,
  timers: systemTimers,
  escrowGateway: defaultEscrowGateway(),
});
// Stale-socket sweep: Socket.IO v4 tracks live connections server-side.
const sioConnected = new Set<string>();
const sessions = new SessionRegistry(store, (sid) => sioConnected.has(sid));

// Boot self-check result, exposed on /health so the UI can show it. A failure
// does not stop the server: a dead RPC must not kill a live demo.
const health: ChainHealth = { enabled: status.enabled, detail: status.detail, selfCheck: null };
registerRoutes(app, store, () => health);

const sio = new IOServer(app.server, {
  cors: {
    // dev: allow-all. PRODUCTION: same env contract as REST CORS
    // (ALLOWED_ORIGINS); must be set before any public deploy.
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : true,
    credentials: true,
  },
});
sio.on('connection', (sock) => {
  sioConnected.add(sock.id);
  sock.on('disconnect', () => sioConnected.delete(sock.id));
});
const stopSocketLoop = attachSocketHandlers(sio, store, sessions, {
  settlementChain: chain.enabled ? realSettlementChain : null,
});

// Startup self-check (ABI_HANDOFF §9). Loud on failure, never fatal: the game
// must keep serving even if the RPC or SETTLER_ROLE is broken.
if (chain.enabled) {
  void selfCheck()
    .then((res) => {
      health.selfCheck = { ok: res.hasSettlerRole, chainId: res.chainId, hasSettlerRole: res.hasSettlerRole };
      if (!res.hasSettlerRole) {
        app.log.error(
          { settler: res.settlerAddress, chainId: res.chainId },
          'CHAIN SELF-CHECK FAILED: settler key does not hold SETTLER_ROLE — settlement will fail',
        );
      } else {
        app.log.info({ chainId: res.chainId, settler: res.settlerAddress }, 'chain self-check ok');
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      health.selfCheck = { ok: false, error: message };
      app.log.error({ err: message }, 'CHAIN SELF-CHECK FAILED (RPC/chainId) — continuing without settlement guarantee');
    });
}

async function graceful(signal: string) {
  app.log.info({ signal }, 'shutting down');
  stopSocketLoop();
  sio.close();
  await app.close();
  process.exit(0);
}
process.on('SIGINT', () => void graceful('SIGINT'));
process.on('SIGTERM', () => void graceful('SIGTERM'));

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err, 'failed to start');
  process.exit(1);
});
