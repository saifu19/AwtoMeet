/**
 * Internal API key authentication for worker-to-API calls.
 * Uses constant-time comparison to prevent timing attacks.
 */

import crypto from 'node:crypto';
import { FastifyRequest, FastifyReply } from 'fastify';

export async function requireInternalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const expected = process.env.INTERNAL_API_KEY;
  const provided = request.headers['x-internal-key'];

  // Single uniform 401 for all auth failure modes (missing config, missing
  // header, wrong key) so attackers cannot enumerate server config state.
  // The lack of config IS logged server-side for the operator.
  if (!expected) {
    request.log.error(
      'INTERNAL_API_KEY not configured — rejecting internal request',
    );
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid internal API key',
      status_code: 401,
    });
  }

  if (typeof provided !== 'string' || !provided) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid internal API key',
      status_code: 401,
    });
  }

  // Constant-time comparison to prevent timing attacks. The length pre-check
  // exits early on length mismatch (lengths are not secrets) so equal-length
  // inputs always reach timingSafeEqual.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');

  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid internal API key',
      status_code: 401,
    });
  }
}
