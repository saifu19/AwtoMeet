import { describe, it, expect } from 'vitest';
import { canAccess, assertCanAccess, ForbiddenError } from '../assertCanAccess.js';
import type { AuthUser, OwnedResource } from '../types.js';

const userA: AuthUser = { id: 'user_a', email: 'a@test.com' };
const userB: AuthUser = { id: 'user_b', email: 'b@test.com' };

const resourceOwnedByA: OwnedResource = { user_id: 'user_a', org_id: null };
const resourceWithOrg: OwnedResource = { user_id: 'user_a', org_id: 'org_1' };

describe('ForbiddenError', () => {
  it('has statusCode 404 and message not_found', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('not_found');
    expect(err.name).toBe('ForbiddenError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('canAccess', () => {
  it('returns true when user_id matches', () => {
    expect(canAccess(userA, resourceOwnedByA)).toBe(true);
  });

  it('returns false when user_id does not match', () => {
    expect(canAccess(userB, resourceOwnedByA)).toBe(false);
  });

  it('returns false when org_id is set but user does not match (org check not active)', () => {
    expect(canAccess(userB, resourceWithOrg)).toBe(false);
  });

  it('returns true for owner even when org_id is set', () => {
    expect(canAccess(userA, resourceWithOrg)).toBe(true);
  });
});

describe('assertCanAccess', () => {
  it('does not throw when user owns resource', () => {
    expect(() => assertCanAccess(userA, resourceOwnedByA)).not.toThrow();
  });

  it('throws ForbiddenError when user does not own resource', () => {
    expect(() => assertCanAccess(userB, resourceOwnedByA)).toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when resource is null', () => {
    expect(() => assertCanAccess(userA, null)).toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when resource is undefined', () => {
    expect(() => assertCanAccess(userA, undefined)).toThrow(ForbiddenError);
  });
});
