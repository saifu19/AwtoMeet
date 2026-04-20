import { z } from 'zod';
import { UlidSchema, IsoDateSchema } from './common.js';

export const InviteRoleSchema = z.enum(['host', 'participant', 'observer']);
export type InviteRoleSchema = z.infer<typeof InviteRoleSchema>;

export const InviteSchema = z.object({
  id: UlidSchema,
  meeting_id: UlidSchema,
  invited_email: z.email().max(255),
  invited_user_id: UlidSchema.nullable(),
  role: InviteRoleSchema,
  can_view_insights: z.boolean(),
  invite_token: z.string().max(64),
  accepted_at: IsoDateSchema.nullable(),
  created_at: IsoDateSchema,
});
export type InviteSchema = z.infer<typeof InviteSchema>;

export const CreateInviteReq = z.object({
  invited_email: z.email().max(255),
  role: InviteRoleSchema.optional(),
  can_view_insights: z.boolean(),
});
export type CreateInviteReq = z.infer<typeof CreateInviteReq>;

export const UpdateInviteReq = z.object({
  role: InviteRoleSchema.optional(),
  can_view_insights: z.boolean().optional(),
});
export type UpdateInviteReq = z.infer<typeof UpdateInviteReq>;

export const AcceptInviteRes = z.object({
  meeting_id: UlidSchema,
  role: InviteRoleSchema,
});
export type AcceptInviteRes = z.infer<typeof AcceptInviteRes>;
