import {
  AuthSessionSchema,
  type AuthSession,
  OAuthStartResponseSchema,
  SpaceUrlSchema
} from '@baklogmd/shared';
import { ZodError } from 'zod';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

async function parseError(response: Response): Promise<Error> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { message?: string };
    return new Error(json.message ?? `Request failed: ${response.status}`);
  } catch {
    return new Error(text || `Request failed: ${response.status}`);
  }
}

function normalizeSpaceUrlInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function validateBacklogSpaceHost(spaceUrl: string): void {
  const host = new URL(spaceUrl).hostname.toLowerCase();
  const bareHosts = new Set(['backlog.com', 'backlog.jp', 'backlogtool.com']);
  if (bareHosts.has(host)) {
    throw new Error(
      'Space URLが不正です。`https://your-space.backlog.com` のようにスペース名付きのURLを入力してください。'
    );
  }
}

export async function startBacklogOAuth(spaceUrl: string): Promise<string> {
  try {
    const normalized = normalizeSpaceUrlInput(spaceUrl);
    const validSpaceUrl = SpaceUrlSchema.parse(normalized);
    validateBacklogSpaceHost(validSpaceUrl);
    const response = await fetch(
      `${API_BASE_URL}/oauth/backlog/start?spaceUrl=${encodeURIComponent(validSpaceUrl)}`,
      { credentials: 'include' }
    );

    if (!response.ok) {
      throw await parseError(response);
    }

    const data = OAuthStartResponseSchema.parse(await response.json());
    return data.authorizationUrl;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error('Space URLは `https://xxx.backlog.jp` 形式で入力してください。');
    }
    if (error instanceof TypeError) {
      throw new Error(`APIに接続できません。APIサーバー起動とCORS設定を確認してください: ${API_BASE_URL}`);
    }
    throw error;
  }
}

export async function completeBacklogOAuth(code: string, state: string): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/oauth/backlog/callback`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state })
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return AuthSessionSchema.parse(await response.json());
}

export async function loadAuthSession(): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/session`, {
    credentials: 'include'
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return AuthSessionSchema.parse(await response.json());
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include'
  });

  if (!response.ok) {
    throw await parseError(response);
  }
}
