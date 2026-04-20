import { describe, it, expect, beforeEach } from 'vitest';
import { getAccessToken, setAccessToken } from '../auth-store';

describe('auth-store', () => {
  beforeEach(() => {
    setAccessToken(null);
  });

  it('starts with null token', () => {
    expect(getAccessToken()).toBeNull();
  });

  it('stores and retrieves access token', () => {
    setAccessToken('test-token');
    expect(getAccessToken()).toBe('test-token');
  });

  it('clears token when set to null', () => {
    setAccessToken('test-token');
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});
