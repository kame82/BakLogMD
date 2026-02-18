import { z } from 'zod';

export const APP_NAME = 'BaklogMD';

export const SpaceUrlSchema = z.string().url().min(1);

export type SpaceUrl = z.infer<typeof SpaceUrlSchema>;
