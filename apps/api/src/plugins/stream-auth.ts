import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyStreamSession } from '../auth/stream-session.js';

const STREAM_COOKIE = 'stream_session';

function unauthorized(reply: FastifyReply, message: string) {
  return reply.code(401).send({
    error: 'Unauthorized',
    message,
    status_code: 401,
  });
}

// Used ONLY on GET /meetings/:id/stream. Reads the stream_session cookie,
// verifies the JWT, and confirms the payload's meeting_id matches the :id
// path param. Minted exclusively by POST /meetings/:id/stream-session after
// assertCanViewInsights passes, so possession of a valid cookie is itself
// proof of authorization and the stream handler does not need to recheck.
export async function requireStreamAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = request.cookies?.[STREAM_COOKIE];
  if (!token) {
    return unauthorized(reply, 'Missing stream session');
  }

  let payload: { sub: string; meetingId: string };
  try {
    payload = await verifyStreamSession(token);
  } catch {
    return unauthorized(reply, 'Invalid or expired stream session');
  }

  const params = request.params as { id?: string } | undefined;
  if (!params?.id || params.id !== payload.meetingId) {
    return unauthorized(reply, 'Stream session does not match meeting');
  }

  request.user = { id: payload.sub, email: '' };
}
