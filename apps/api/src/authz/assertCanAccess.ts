import type { AuthUser, OwnedResource } from './types.js';

export class ForbiddenError extends Error {
  statusCode = 404;

  constructor() {
    super('not_found');
    this.name = 'ForbiddenError';
  }
}

export function canAccess(user: AuthUser, resource: OwnedResource): boolean {
  if (resource.user_id === user.id) return true;
  // FUTURE: org membership check
  // if (resource.org_id && user.org_ids?.includes(resource.org_id)) return true;
  return false;
}

export function assertCanAccess(
  user: AuthUser,
  resource: OwnedResource | null | undefined,
): asserts resource is OwnedResource {
  if (!resource || !canAccess(user, resource)) throw new ForbiddenError();
}
