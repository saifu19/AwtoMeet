import { z } from 'zod';
import { UlidSchema, IsoDateSchema } from './common.js';

export const MeetingStatusSchema = z.enum(['scheduled', 'live', 'summarizing', 'ended', 'cancelled']);
export type MeetingStatusSchema = z.infer<typeof MeetingStatusSchema>;

export const MeetingSchema = z.object({
  id: UlidSchema,
  user_id: UlidSchema,
  org_id: UlidSchema.nullable(),
  meeting_type_id: UlidSchema.nullable(),
  title: z.string().max(255),
  description: z.string().nullable(),
  scheduled_at: IsoDateSchema.nullable(),
  google_event_id: z.string().max(255).nullable(),
  livekit_room: z.string().max(255),
  status: MeetingStatusSchema,
  worker_job_id: z.string().max(255).nullable(),
  started_at: IsoDateSchema.nullable(),
  ended_at: IsoDateSchema.nullable(),
  // Per-viewer capability flag. Optional because list endpoints return the
  // base meeting shape; only GET /meetings/:id populates it so the frontend
  // can show/hide UI surfaces like "Open Insights" without a second round-trip.
  viewer_can_view_insights: z.boolean().optional(),
});
export type MeetingSchema = z.infer<typeof MeetingSchema>;

export const CreateMeetingReq = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  scheduled_at: IsoDateSchema.optional(),
  meeting_type_id: UlidSchema.optional(),
  auto_classify: z.boolean().optional(),
});
export type CreateMeetingReq = z.infer<typeof CreateMeetingReq>;

export const UpdateMeetingReq = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  scheduled_at: IsoDateSchema.optional(),
  meeting_type_id: UlidSchema.nullable().optional(),
  auto_classify: z.boolean().optional(),
  status: MeetingStatusSchema.optional(),
});
export type UpdateMeetingReq = z.infer<typeof UpdateMeetingReq>;

export const JoinMeetingRes = z.object({
  livekit_url: z.url(),
  livekit_token: z.string(),
});
export type JoinMeetingRes = z.infer<typeof JoinMeetingRes>;

export const ListMeetingsQuery = z.object({
  status: z.enum(['scheduled', 'live', 'summarizing', 'ended']).optional(),
});
export type ListMeetingsQuery = z.infer<typeof ListMeetingsQuery>;

export const GuestJoinReq = z.object({
  display_name: z.string().min(1).max(100),
});
export type GuestJoinReq = z.infer<typeof GuestJoinReq>;
