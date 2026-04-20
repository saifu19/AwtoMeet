import crypto from 'node:crypto';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '../db/client.js';
import { sessions } from '../db/schema.js';

const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(
  userId: string,
): Promise<{ sessionId: string; refreshToken: string; expiresAt: Date }> {
  const sessionId = ulid();
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshTokenHash = await argon2.hash(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    refreshTokenHash,
    expiresAt,
  });

  return { sessionId, refreshToken, expiresAt };
}

export async function rotateSession(
  oldToken: string,
  sessionId: string,
): Promise<{
  refreshToken: string;
  expiresAt: Date;
  userId: string;
}> {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  if (!session) {
    throw new Error('Session not found');
  }

  // Check expiry
  if (session.expiresAt < new Date()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    throw new Error('Session expired');
  }

  // Verify token hash — mismatch means potential theft
  const valid = await argon2.verify(session.refreshTokenHash, oldToken);
  if (!valid) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    throw new Error('Invalid refresh token');
  }

  // Rotate: new token, new hash, new expiry
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshTokenHash = await argon2.hash(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  await db
    .update(sessions)
    .set({ refreshTokenHash, expiresAt })
    .where(eq(sessions.id, sessionId));

  return { refreshToken, expiresAt, userId: session.userId };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
