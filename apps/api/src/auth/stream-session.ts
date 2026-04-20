import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const secret = new TextEncoder().encode(JWT_SECRET);

// Short-lived token that only authorizes the SSE handshake. The cookie is
// validated once by requireStreamAuth when the EventSource connects; the open
// stream then runs for up to MAX_STREAM_MS without any further checks. A 60s
// TTL shrinks the leak window to the minimum needed to complete the handshake.
const STREAM_TOKEN_TTL = '60s';

export async function signStreamSession(
  sub: string,
  meetingId: string,
): Promise<string> {
  return new SignJWT({ kind: 'stream', meeting_id: meetingId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(STREAM_TOKEN_TTL)
    .sign(secret);
}

export async function verifyStreamSession(
  token: string,
): Promise<{ sub: string; meetingId: string }> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],
  });

  if (
    payload.kind !== 'stream' ||
    typeof payload.meeting_id !== 'string' ||
    !payload.sub
  ) {
    throw new Error('Invalid stream session payload');
  }

  return { sub: payload.sub, meetingId: payload.meeting_id };
}
