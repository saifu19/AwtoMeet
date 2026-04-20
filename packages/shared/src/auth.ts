import { z } from 'zod';
import { UlidSchema, IsoDateSchema } from './common.js';

export const UserSchema = z.object({
  id: UlidSchema,
  email: z.email().max(255),
  display_name: z.string().max(255),
  is_superadmin: z.boolean(),
  created_at: IsoDateSchema,
});
export type UserSchema = z.infer<typeof UserSchema>;

export const SignupReq = z.object({
  email: z.email().max(255),
  password: z.string().min(8).max(128),
  display_name: z.string().min(1).max(255),
});
export type SignupReq = z.infer<typeof SignupReq>;

export const LoginReq = z.object({
  email: z.email().max(255),
  password: z.string().min(1),
});
export type LoginReq = z.infer<typeof LoginReq>;

export const AuthRes = z.object({
  access: z.string(),
  user: UserSchema,
});
export type AuthRes = z.infer<typeof AuthRes>;

export const RefreshRes = z.object({
  access: z.string(),
});
export type RefreshRes = z.infer<typeof RefreshRes>;

export const MeRes = UserSchema;
export type MeRes = z.infer<typeof MeRes>;
