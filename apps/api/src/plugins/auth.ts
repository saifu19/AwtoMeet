import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccess } from '../auth/jwt.js';
import type { AuthUser } from '../authz/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing bearer token',
      status_code: 401,
    });
  }

  const token = authHeader.slice(7);
  try {
    const jwt = await verifyAccess(token);
    request.user = { id: jwt.sub, email: jwt.email };
  } catch {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
      status_code: 401,
    });
  }
}
