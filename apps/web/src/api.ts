import {
  AuthSessionSchema,
  type AuthSession,
  IssueDetailSchema,
  IssueSummariesResponseSchema,
  OAuthStartResponseSchema,
  ProjectsResponseSchema,
  SpaceUrlSchema
} from '@baklogmd/shared';
import { ZodError } from 'zod';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:43100';
const CSRF_COOKIE_NAME = import.meta.env.VITE_CSRF_COOKIE_NAME ?? 'baklogmd_csrf';

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

function getCookie(name: string): string | null {
  const chunks = document.cookie.split(';');
  for (const chunk of chunks) {
    const [k, ...v] = chunk.trim().split('=');
    if (k === name) {
      return decodeURIComponent(v.join('='));
    }
  }
  return null;
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
  const csrfToken = getCookie(CSRF_COOKIE_NAME);
  const response = await fetch(`${API_BASE_URL}/oauth/backlog/callback`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
    },
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
  const csrfToken = getCookie(CSRF_COOKIE_NAME);
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
    }
  });

  if (!response.ok) {
    throw await parseError(response);
  }
}

export async function fetchProjects() {
  const response = await fetch(`${API_BASE_URL}/backlog/projects`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return ProjectsResponseSchema.parse(await response.json());
}

export async function searchIssues(mode: 'key' | 'keyword', q: string) {
  const query = q.trim();
  if (!query) {
    throw new Error('検索語を入力してください。');
  }

  const response = await fetch(
    `${API_BASE_URL}/backlog/issues/search?mode=${encodeURIComponent(mode)}&q=${encodeURIComponent(query)}`,
    { credentials: 'include' }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  return IssueSummariesResponseSchema.parse(await response.json());
}

export async function fetchIssueDetail(issueKey: string) {
  const key = issueKey.trim();
  if (!key) {
    throw new Error('issueKey is required.');
  }

  const response = await fetch(`${API_BASE_URL}/backlog/issues/${encodeURIComponent(key)}`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return IssueDetailSchema.parse(await response.json());
}
