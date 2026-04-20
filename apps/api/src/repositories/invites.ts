import crypto from 'node:crypto';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { meetingInvites, meetings, users } from '../db/schema.js';

type InviteRow = typeof meetingInvites.$inferSelect;

export function toInviteResponse(row: InviteRow) {
  return {
    id: row.id,
    meeting_id: row.meetingId,
    invited_email: row.invitedEmail,
    invited_user_id: row.invitedUserId ?? null,
    role: row.role,
    can_view_insights: row.canViewInsights,
    invite_token: row.inviteToken,
    accepted_at: row.acceptedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export async function listByMeeting(meetingId: string) {
  const rows = await db
    .select()
    .from(meetingInvites)
    .where(eq(meetingInvites.meetingId, meetingId));
  return rows.map(toInviteResponse);
}

export async function getById(id: string) {
  const rows = await db
    .select()
    .from(meetingInvites)
    .where(eq(meetingInvites.id, id));
  const row = rows[0];
  if (!row) return null;
  return toInviteResponse(row);
}

export async function getByToken(token: string) {
  const rows = await db
    .select()
    .from(meetingInvites)
    .where(eq(meetingInvites.inviteToken, token));
  const row = rows[0];
  if (!row) return null;
  return toInviteResponse(row);
}

export async function create(data: {
  id: string;
  meetingId: string;
  invitedEmail: string;
  role: 'host' | 'participant' | 'observer';
  canViewInsights: boolean;
  inviteToken: string;
  invitedUserId?: string | null;
}) {
  await db.insert(meetingInvites).values({
    id: data.id,
    meetingId: data.meetingId,
    invitedEmail: data.invitedEmail,
    role: data.role,
    canViewInsights: data.canViewInsights,
    inviteToken: data.inviteToken,
    invitedUserId: data.invitedUserId ?? null,
  });
}

export async function update(
  id: string,
  patch: Partial<Pick<InviteRow, 'role' | 'canViewInsights'>>,
) {
  await db
    .update(meetingInvites)
    .set(patch)
    .where(eq(meetingInvites.id, id));
}

export async function remove(id: string) {
  await db.delete(meetingInvites).where(eq(meetingInvites.id, id));
}

export async function acceptInvite(id: string, userId: string) {
  await db
    .update(meetingInvites)
    .set({ invitedUserId: userId, acceptedAt: new Date() })
    .where(eq(meetingInvites.id, id));
}

export async function autoBindByEmail(email: string, userId: string) {
  // Link pending invites to the user's account (does NOT set accepted_at)
  await db
    .update(meetingInvites)
    .set({ invitedUserId: userId })
    .where(
      and(
        eq(meetingInvites.invitedEmail, email),
        isNull(meetingInvites.invitedUserId),
      ),
    );
}

/**
 * List pending (not yet accepted) invites for a user, enriched with meeting title.
 */
export async function listPendingForUser(userId: string) {
  const rows = await db
    .select({
      invite: meetingInvites,
      meetingTitle: meetings.title,
      meetingStatus: meetings.status,
      meetingScheduledAt: meetings.scheduledAt,
    })
    .from(meetingInvites)
    .innerJoin(meetings, eq(meetingInvites.meetingId, meetings.id))
    .where(
      and(
        eq(meetingInvites.invitedUserId, userId),
        isNull(meetingInvites.acceptedAt),
      ),
    );
  return rows.map((r) => ({
    ...toInviteResponse(r.invite),
    meeting_title: r.meetingTitle,
    meeting_status: r.meetingStatus,
    meeting_scheduled_at: r.meetingScheduledAt?.toISOString() ?? null,
  }));
}

export async function hasAcceptedInvite(
  userId: string,
  meetingId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: meetingInvites.id })
    .from(meetingInvites)
    .where(
      and(
        eq(meetingInvites.meetingId, meetingId),
        eq(meetingInvites.invitedUserId, userId),
        isNotNull(meetingInvites.acceptedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function hasAcceptedInviteWithInsights(
  userId: string,
  meetingId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: meetingInvites.id })
    .from(meetingInvites)
    .where(
      and(
        eq(meetingInvites.meetingId, meetingId),
        eq(meetingInvites.invitedUserId, userId),
        isNotNull(meetingInvites.acceptedAt),
        eq(meetingInvites.canViewInsights, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listAcceptedInviteesWithInsights(
  meetingId: string,
): Promise<Array<{ email: string; displayName: string }>> {
  const rows = await db
    .select({
      email: users.email,
      displayName: users.displayName,
    })
    .from(meetingInvites)
    .innerJoin(users, eq(meetingInvites.invitedUserId, users.id))
    .where(
      and(
        eq(meetingInvites.meetingId, meetingId),
        isNotNull(meetingInvites.acceptedAt),
        eq(meetingInvites.canViewInsights, true),
      ),
    );
  return rows;
}

export async function findUserByEmail(email: string) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0] ?? null;
}
