import { ForbiddenError } from './assertCanAccess.js';
import * as meetingsRepo from '../repositories/meetings.js';
import * as invitesRepo from '../repositories/invites.js';

export async function canJoinRoom(
  userId: string,
  meetingId: string,
): Promise<boolean> {
  const meeting = await meetingsRepo.getById(meetingId);
  if (!meeting) return false;
  if (meeting.user_id === userId) return true;
  return invitesRepo.hasAcceptedInvite(userId, meetingId);
}

export async function canViewInsights(
  userId: string,
  meetingId: string,
): Promise<boolean> {
  const meeting = await meetingsRepo.getById(meetingId);
  if (!meeting) return false;
  if (meeting.user_id === userId) return true;
  return invitesRepo.hasAcceptedInviteWithInsights(userId, meetingId);
}

export async function assertCanJoinRoom(
  userId: string,
  meetingId: string,
): Promise<void> {
  const allowed = await canJoinRoom(userId, meetingId);
  if (!allowed) throw new ForbiddenError();
}

export async function assertCanViewInsights(
  userId: string,
  meetingId: string,
): Promise<void> {
  const allowed = await canViewInsights(userId, meetingId);
  if (!allowed) throw new ForbiddenError();
}
