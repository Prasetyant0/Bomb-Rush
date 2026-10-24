// Server entrypoint: Fastify HTTP + Socket.IO, graceful shutdown.
// Runs fully local tonight — no Postgres, no Monad testnet, no assets needed.
import Fastify from 'fastify';
import { Server as IOServer } from 'socket.io';
import { attachCors } from './api/cors.js';
import { registerRoutes } from './api/routes.js';
import { RoomStore } from './game/store.js';
import { attachSocketHandlers } from './net/socketAdapter.js';
import { SessionRegistry } from './net/sessions.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });
attachCors(app);

const systemClock = { now: () => Date.now() };
const systemTimers = { set: (cb: () => void, ms: number) => setTimeout(cb, ms), clear: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };
const store = new RoomStore({ clock: systemClock, timers: systemTimers });
// Stale-socket sweep: Socket.IO v4 tracks live connections server-side.
const sioConnected = new Set<string>();
const sessions = new SessionRegistry(store, (sid) => sioConnected.has(sid));

registerRoutes(app, store);

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
const stopSocketLoop = attachSocketHandlers(sio, store, sessions);

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
