import { z } from 'zod';

// Must match apps/worker/src/captions.py CAPTION_TOPIC — cross-runtime contract.
export const CAPTION_TOPIC = 'transcript' as const;

export const CaptionPayloadSchema = z.object({
  speaker_identity: z.string(),
  speaker_name: z.string(),
  text: z.string(),
  start_ts_ms: z.number().int(),
  end_ts_ms: z.number().int(),
});
export type CaptionPayload = z.infer<typeof CaptionPayloadSchema>;
