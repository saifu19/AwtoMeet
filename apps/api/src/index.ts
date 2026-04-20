import 'dotenv/config';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { errorHandler } from './plugins/error-handler.js';
import authRoutes from './routes/auth.js';
import agentRoutes from './routes/agents.js';
import meetingTypeRoutes from './routes/meeting-types.js';
import meetingRoutes from './routes/meetings.js';
import {
  meetingInviteRoutes,
  inviteAcceptRoutes,
} from './routes/invites.js';

function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const required = ['WEB_URL', 'JWT_SECRET', 'LIVEKIT_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'INTERNAL_API_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars in production: ${missing.join(', ')}`,
    );
  }
}

async function main() {
  assertProductionEnv();
  const app = Fastify({ logger: true });

  // Plugins
  await app.register(cookie);
  // CORS: allow only the web app origin. Credentials=true is required so
  // the browser will send the httpOnly refresh cookie on /auth/refresh.
  // In dev WEB_URL defaults to Vite's local port; in prod assertProductionEnv
  // guarantees the env var is set, so this list is always non-empty.
  const webOrigin = process.env.WEB_URL ?? 'http://localhost:5173';
  await app.register(cors, {
    origin: [webOrigin],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Rate limiting: global fallback, with tighter per-route caps applied on
  // auth endpoints (see routes/auth.ts). Global cap protects against naive
  // spray-and-pray while per-route caps protect brute-force surfaces.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: (req) => req.url?.startsWith('/api/v0/health') ?? false,
  });

  // Decorations (must come before routes)
  app.decorateRequest('user', undefined);

  // Routes — everything under /api/v0
  await app.register(
    async function apiV0(api) {
      api.setErrorHandler(errorHandler);
      api.get('/health', async () => ({ ok: true }));
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(agentRoutes, { prefix: '/agents' });
      await api.register(meetingTypeRoutes, { prefix: '/meeting-types' });
      await api.register(meetingRoutes, { prefix: '/meetings' });
      await api.register(meetingInviteRoutes, { prefix: '/meetings' });
      await api.register(inviteAcceptRoutes, { prefix: '/invites' });
    },
    { prefix: '/api/v0' },
  );

  // Start
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
