// CORS: development default allows any origin (local dev convenience).
// PRODUCTION: set ALLOWED_ORIGINS="https://app.example.com,https://app2" —
// unset/misconfigured ALLOWED_ORIGINS keeps allow-all, which must never ship
// publicly (documented in FRONTEND_INTEGRATION_CHECKLIST § production).
import type { FastifyInstance } from 'fastify';

export function attachCors(app: FastifyInstance) {
  const allowed = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    // REST CORS; socket.io has its own config in index.ts
    const allow = allowed.length === 0 ? '*' : (origin != null && allowed.includes(origin) ? origin : allowed[0]);
    reply.header('Access-Control-Allow-Origin', allow);
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Access-Control-Allow-Headers', 'content-type');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });
}
