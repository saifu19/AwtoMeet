import { z } from 'zod';
import { UlidSchema, IsoDateSchema, LlmProviderSchema } from './common.js';

export const AgentSchema = z.object({
  id: UlidSchema,
  user_id: UlidSchema,
  org_id: UlidSchema.nullable(),
  name: z.string().max(255),
  system_prompt: z.string(),
  provider: z.string().max(32).nullable(),
  model: z.string().max(64).nullable(),
  created_at: IsoDateSchema,
});
export type AgentSchema = z.infer<typeof AgentSchema>;

export const CreateAgentReq = z.object({
  name: z.string().min(1).max(255),
  system_prompt: z.string().min(1),
  provider: LlmProviderSchema.optional(),
  model: z.string().max(64).optional(),
});
export type CreateAgentReq = z.infer<typeof CreateAgentReq>;

export const UpdateAgentReq = z.object({
  name: z.string().min(1).max(255).optional(),
  system_prompt: z.string().min(1).optional(),
  provider: LlmProviderSchema.optional(),
  model: z.string().max(64).optional(),
});
export type UpdateAgentReq = z.infer<typeof UpdateAgentReq>;
