import { describe, it, expect, beforeAll } from 'vitest';

// Set env before importing the module
beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256';
});

describe('jwt', () => {
  it('sign and verify roundtrip returns correct payload', async () => {
    // Dynamic import so env is set first
    const { signAccess, verifyAccess } = await import('../jwt.js');
    const token = await signAccess('user123', 'test@example.com');
    const payload = await verifyAccess(token);
    expect(payload.sub).toBe('user123');
    expect(payload.email).toBe('test@example.com');
  });

  it('verifyAccess rejects a tampered token', async () => {
    const { signAccess, verifyAccess } = await import('../jwt.js');
    const token = await signAccess('user123', 'test@example.com');
    const tampered = token.slice(0, -4) + 'XXXX';
    await expect(verifyAccess(tampered)).rejects.toThrow();
  });

  it('verifyAccess rejects garbage input', async () => {
    const { verifyAccess } = await import('../jwt.js');
    await expect(verifyAccess('not.a.token')).rejects.toThrow();
  });
});
