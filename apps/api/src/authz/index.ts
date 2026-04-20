export type { AuthUser, OwnedResource } from './types.js';
export { ForbiddenError, canAccess, assertCanAccess } from './assertCanAccess.js';
export {
  canJoinRoom,
  canViewInsights,
  assertCanJoinRoom,
  assertCanViewInsights,
} from './meeting-access.js';
