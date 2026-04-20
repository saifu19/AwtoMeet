import { z } from 'zod';
import { UlidSchema, IsoDateSchema } from './common.js';

export const MeetingSummarySchema = z.object({
  id: z.number().int(),
  meeting_id: UlidSchema,
  agenda_findings: z.record(z.string(), z.string()).nullable(),
  raw_summary: z.string().nullable(),
  generated_at: IsoDateSchema,
});
export type MeetingSummarySchema = z.infer<typeof MeetingSummarySchema>;

export const MeetingSummaryResponseSchema = z.object({
  id: z.number().int(),
  meeting_id: UlidSchema,
  title: z.string(),
  agenda_items: z.array(z.string()).nullable(),
  agenda_findings: z.record(z.string(), z.string()).nullable(),
  raw_summary: z.string().nullable(),
  generated_at: IsoDateSchema,
});
export type MeetingSummaryResponseSchema = z.infer<typeof MeetingSummaryResponseSchema>;
