import { z } from 'zod';
import { UlidSchema, IsoDateSchema } from './common.js';

export const AdminUserRowSchema = z.object({
  id: UlidSchema,
  email: z.email().max(255),
  display_name: z.string().max(255),
  is_superadmin: z.boolean(),
  created_at: IsoDateSchema,
});
export type AdminUserRowSchema = z.infer<typeof AdminUserRowSchema>;

export const UsageCounterSchema = z.object({
  id: z.number().int(),
  user_id: UlidSchema,
  org_id: UlidSchema.nullable(),
  period: z.string().length(7),
  meeting_minutes: z.number().int(),
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  cost_usd: z.string(),
});
export type UsageCounterSchema = z.infer<typeof UsageCounterSchema>;

export const UsageLimitsSchema = z.object({
  id: z.number().int(),
  user_id: UlidSchema.nullable(),
  org_id: UlidSchema.nullable(),
  max_meeting_minutes_per_month: z.number().int().nullable(),
  max_cost_usd_per_month: z.string().nullable(),
  max_agents: z.number().int().nullable(),
  updated_at: IsoDateSchema,
});
export type UsageLimitsSchema = z.infer<typeof UsageLimitsSchema>;

export const UpdateLimitsReq = z.object({
  max_meeting_minutes_per_month: z.number().int().nullable().optional(),
  max_cost_usd_per_month: z.number().nullable().optional(),
  max_agents: z.number().int().nullable().optional(),
});
export type UpdateLimitsReq = z.infer<typeof UpdateLimitsReq>;
