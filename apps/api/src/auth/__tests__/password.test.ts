import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../password.js';

describe('password', () => {
  it('hashPassword returns an argon2id hash', async () => {
    const hash = await hashPassword('mysecretpassword');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('verifyPassword returns true for matching password', async () => {
    const hash = await hashPassword('correcthorse');
    const result = await verifyPassword(hash, 'correcthorse');
    expect(result).toBe(true);
  });

  it('verifyPassword returns false for wrong password', async () => {
    const hash = await hashPassword('correcthorse');
    const result = await verifyPassword(hash, 'wrongpassword');
    expect(result).toBe(false);
  });

  it('verifyPassword returns false for garbage hash', async () => {
    const result = await verifyPassword('not-a-real-hash', 'anything');
    expect(result).toBe(false);
  });
});
