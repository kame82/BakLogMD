import { z } from 'zod';

export const APP_NAME = 'BaklogMD';

export const SpaceUrlSchema = z.string().url().min(1);
export const OAuthStartResponseSchema = z.object({
  authorizationUrl: z.string().url()
});

export const OAuthCallbackRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

export const AuthUserSchema = z.object({
  id: z.number(),
  userId: z.string(),
  name: z.string()
});

export const AuthSessionSchema = z.object({
  authenticated: z.boolean(),
  spaceUrl: z.string().url().optional(),
  expiresAt: z.string().optional(),
  user: AuthUserSchema.optional()
});

export type SpaceUrl = z.infer<typeof SpaceUrlSchema>;
export type OAuthStartResponse = z.infer<typeof OAuthStartResponseSchema>;
export type OAuthCallbackRequest = z.infer<typeof OAuthCallbackRequestSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
