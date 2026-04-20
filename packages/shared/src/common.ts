import { z } from 'zod';

// -- Reusable primitives --

export const UlidSchema = z.string().length(26);
export type UlidSchema = z.infer<typeof UlidSchema>;

export const IsoDateSchema = z.iso.datetime();
export type IsoDateSchema = z.infer<typeof IsoDateSchema>;

export const LlmProviderSchema = z.enum(['openai', 'anthropic']);
export type LlmProviderSchema = z.infer<typeof LlmProviderSchema>;

// -- Shared error response --

export const ErrorResponse = z.object({
  error: z.string(),
  message: z.string(),
  status_code: z.number().int(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
