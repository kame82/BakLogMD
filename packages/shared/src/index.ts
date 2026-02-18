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

export const ProjectSchema = z.object({
  id: z.number(),
  projectKey: z.string(),
  name: z.string(),
  syncedAt: z.string()
});

export const IssueSummarySchema = z.object({
  issueKey: z.string(),
  summary: z.string(),
  updatedAt: z.string()
});

export const IssueDetailSchema = z.object({
  issueKey: z.string(),
  summary: z.string(),
  descriptionRaw: z.string(),
  updatedAt: z.string(),
  syncedAt: z.string()
});

export const ProjectsResponseSchema = z.array(ProjectSchema);
export const IssueSummariesResponseSchema = z.array(IssueSummarySchema);

export type SpaceUrl = z.infer<typeof SpaceUrlSchema>;
export type OAuthStartResponse = z.infer<typeof OAuthStartResponseSchema>;
export type OAuthCallbackRequest = z.infer<typeof OAuthCallbackRequestSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type IssueSummary = z.infer<typeof IssueSummarySchema>;
export type IssueDetail = z.infer<typeof IssueDetailSchema>;
