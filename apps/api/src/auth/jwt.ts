import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const secret = new TextEncoder().encode(JWT_SECRET);

export async function signAccess(
  sub: string,
  email: string,
): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

export async function verifyAccess(
  token: string,
): Promise<{ sub: string; email: string }> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],
  });

  if (!payload.sub || typeof payload.email !== 'string') {
    throw new Error('Invalid token payload');
  }

  return { sub: payload.sub, email: payload.email };
}
