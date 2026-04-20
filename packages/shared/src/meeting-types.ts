import { z } from 'zod';
import { UlidSchema, IsoDateSchema } from './common.js';

export const MeetingTypeSchema = z.object({
  id: UlidSchema,
  user_id: UlidSchema,
  org_id: UlidSchema.nullable(),
  name: z.string().max(255),
  description: z.string().nullable(),
  agenda_items: z.array(z.string()).nullable(),
  buffer_size: z.number().int(),
  created_at: IsoDateSchema,
  agent_ids: z.array(UlidSchema).optional(),
});
export type MeetingTypeSchema = z.infer<typeof MeetingTypeSchema>;

export const CreateMeetingTypeReq = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  agenda_items: z.array(z.string()).optional(),
  agent_ids: z.array(UlidSchema).optional(),
  buffer_size: z.number().int().min(1).optional(),
});
export type CreateMeetingTypeReq = z.infer<typeof CreateMeetingTypeReq>;

export const UpdateMeetingTypeReq = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  agenda_items: z.array(z.string()).optional(),
  agent_ids: z.array(UlidSchema).optional(),
  buffer_size: z.number().int().min(1).optional(),
});
export type UpdateMeetingTypeReq = z.infer<typeof UpdateMeetingTypeReq>;
