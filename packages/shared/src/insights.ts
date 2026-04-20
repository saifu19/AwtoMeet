import { z } from 'zod';
import { UlidSchema, IsoDateSchema } from './common.js';

export const TranscriptMessageSchema = z.object({
  id: z.number().int(),
  meeting_id: UlidSchema,
  speaker_identity: z.string().max(255),
  speaker_name: z.string().max(255),
  text: z.string(),
  start_ts_ms: z.number().int(),
  end_ts_ms: z.number().int(),
  created_at: IsoDateSchema,
});
export type TranscriptMessageSchema = z.infer<typeof TranscriptMessageSchema>;

export const AgentOutputSchema = z.object({
  id: z.number().int(),
  agent_run_id: z.number().int(),
  meeting_id: UlidSchema,
  agent_id: UlidSchema,
  agent_name: z.string().max(255),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: IsoDateSchema,
});
export type AgentOutputSchema = z.infer<typeof AgentOutputSchema>;

export const SseTranscriptEvent = z.object({
  type: z.literal('transcript'),
  data: TranscriptMessageSchema,
});
export type SseTranscriptEvent = z.infer<typeof SseTranscriptEvent>;

export const SseInsightEvent = z.object({
  type: z.literal('insight'),
  data: AgentOutputSchema,
});
export type SseInsightEvent = z.infer<typeof SseInsightEvent>;

export const SseEvent = z.discriminatedUnion('type', [
  SseTranscriptEvent,
  SseInsightEvent,
]);
export type SseEvent = z.infer<typeof SseEvent>;
