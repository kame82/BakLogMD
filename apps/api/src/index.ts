import 'dotenv/config';
import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import {
  APP_NAME,
  AuthSessionSchema,
  OAuthCallbackRequestSchema,
  SpaceUrlSchema
} from '@baklogmd/shared';
import { z } from 'zod';

type PendingAuth = {
  sid: string;
  spaceUrl: string;
  expiresAt: number;
  csrfToken: string;
};

type AuthSession = {
  sid: string;
  spaceUrl: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  csrfToken: string;
  user: {
    id: number;
    userId: string;
    name: string;
  };
};

const BacklogTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional()
});

const BacklogUserSchema = z.object({
  id: z.number(),
  userId: z.string(),
  name: z.string()
});

const BacklogProjectSchema = z.object({
  id: z.number(),
  projectKey: z.string(),
  name: z.string()
});

const BacklogIssueSchema = z.object({
  issueKey: z.string(),
  summary: z.string(),
  description: z.string().nullable().optional(),
  updated: z.string()
});

const app = express();
const port = Number(process.env.PORT ?? 3000);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5174')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const stateSecret = process.env.OAUTH_STATE_SECRET ?? '';
const cookieName = process.env.SESSION_COOKIE_NAME ?? 'baklogmd_sid';
const csrfCookieName = process.env.CSRF_COOKIE_NAME ?? 'baklogmd_csrf';
const isSecureCookie = process.env.NODE_ENV === 'production';
const allowedBacklogHostSuffixes = ['.backlog.com', '.backlog.jp', '.backlogtool.com'];

const pendingAuth = new Map<string, PendingAuth>();
const sessions = new Map<string, AuthSession>();

if (!process.env.BACKLOG_CLIENT_ID || !process.env.BACKLOG_CLIENT_SECRET || !process.env.BACKLOG_REDIRECT_URI) {
  throw new Error(
    'Missing required env. BACKLOG_CLIENT_ID, BACKLOG_CLIENT_SECRET, BACKLOG_REDIRECT_URI must be configured.'
  );
}
if (!stateSecret || stateSecret.length < 32) {
  throw new Error('OAUTH_STATE_SECRET must be configured and at least 32 characters long.');
}

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowedOrigins.includes(origin));
    },
    credentials: true
  })
);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) {
    res.status(403).json({ message: 'Invalid origin.' });
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, app: APP_NAME, service: 'oauth-broker-api' });
});

app.get('/oauth/backlog/start', (req, res) => {
  if (!process.env.BACKLOG_CLIENT_ID || !process.env.BACKLOG_REDIRECT_URI) {
    res.status(500).json({ message: 'Backlog OAuth env is not configured.' });
    return;
  }

  const parsedSpaceUrl = SpaceUrlSchema.safeParse(req.query.spaceUrl);
  if (!parsedSpaceUrl.success) {
    res.status(400).json({ message: 'Invalid or missing spaceUrl query.' });
    return;
  }

  const validation = validateBacklogSpaceUrl(parsedSpaceUrl.data);
  if (!validation.ok) {
    res.status(400).json({ message: validation.message });
    return;
  }

  const spaceUrl = normalizeSpaceUrl(validation.value);
  const sid = crypto.randomBytes(24).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const state = signState({ sid, spaceUrl, exp: expiresAt });

  pendingAuth.set(sid, { sid, spaceUrl, expiresAt, csrfToken });
  clearExpired();
  setSessionCookie(res, sid);
  setCsrfCookie(res, csrfToken);

  const authUrl = new URL('/OAuth2AccessRequest.action', spaceUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', process.env.BACKLOG_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', process.env.BACKLOG_REDIRECT_URI);
  authUrl.searchParams.set('state', state);

  res.json({
    authorizationUrl: authUrl.toString()
  });
});

app.post('/oauth/backlog/callback', async (req, res) => {
  if (!process.env.BACKLOG_CLIENT_SECRET) {
    res.status(500).json({ message: 'Backlog client secret is missing.' });
    return;
  }

  const parsedReq = OAuthCallbackRequestSchema.safeParse(req.body);
  if (!parsedReq.success) {
    res.status(400).json({ message: 'Invalid callback payload.' });
    return;
  }

  const parsedState = verifyState(parsedReq.data.state);
  if (!parsedState) {
    res.status(401).json({ message: 'Invalid state.' });
    return;
  }

  const sidFromCookie = getCookieValue(req.headers.cookie, cookieName);
  if (!sidFromCookie || sidFromCookie !== parsedState.sid) {
    res.status(401).json({ message: 'Session cookie mismatch.' });
    return;
  }

  const pending = pendingAuth.get(parsedState.sid);
  if (!pending || pending.spaceUrl !== parsedState.spaceUrl || pending.expiresAt < Date.now()) {
    res.status(401).json({ message: 'OAuth session expired.' });
    return;
  }
  if (!verifyCsrf(req, pending.csrfToken)) {
    res.status(403).json({ message: 'Invalid CSRF token.' });
    return;
  }

  try {
    const token = await exchangeToken({
      grantType: 'authorization_code',
      code: parsedReq.data.code,
      spaceUrl: parsedState.spaceUrl
    });
    const user = await fetchBacklogUser(parsedState.spaceUrl, token.access_token);

    const session: AuthSession = {
      sid: parsedState.sid,
      spaceUrl: parsedState.spaceUrl,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      csrfToken: pending.csrfToken,
      user
    };

    sessions.set(parsedState.sid, session);
    pendingAuth.delete(parsedState.sid);

    res.json(
      AuthSessionSchema.parse({
        authenticated: true,
        spaceUrl: session.spaceUrl,
        expiresAt: new Date(session.expiresAt).toISOString(),
        user: session.user
      })
    );
  } catch (error) {
    console.error('[oauth.callback_failed]', {
      spaceUrl: parsedState.spaceUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(401).json({
      message: 'OAuth callback failed.'
    });
  }
});

app.get('/auth/session', async (req, res) => {
  const session = await getActiveSession(req);
  if (!session) {
    res.json(AuthSessionSchema.parse({ authenticated: false }));
    return;
  }
  res.json(toAuthSessionResponse(session));
});

app.get('/backlog/projects', async (req, res) => {
  const session = await getActiveSession(req);
  if (!session) {
    res.status(401).json({ message: 'Not authenticated.' });
    return;
  }

  try {
    const items = await backlogGet(session, '/api/v2/projects');
    const projects = z.array(BacklogProjectSchema).parse(items);
    const now = new Date().toISOString();
    res.json(
      projects.map((p) => ({
        id: p.id,
        projectKey: p.projectKey,
        name: p.name,
        syncedAt: now
      }))
    );
  } catch (error) {
    console.error('[backlog.projects_failed]', {
      spaceUrl: session.spaceUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(502).json({ message: 'Project fetch failed.' });
  }
});

app.get('/backlog/issues/search', async (req, res) => {
  const session = await getActiveSession(req);
  if (!session) {
    res.status(401).json({ message: 'Not authenticated.' });
    return;
  }

  const mode = req.query.mode === 'key' ? 'key' : 'keyword';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.status(400).json({ message: 'Query parameter q is required.' });
    return;
  }

  try {
    const path =
      mode === 'key'
        ? `/api/v2/issues/${encodeURIComponent(q)}`
        : `/api/v2/issues?keyword=${encodeURIComponent(q)}`;
    const payload = await backlogGet(session, path);
    const issues =
      mode === 'key' ? [BacklogIssueSchema.parse(payload)] : z.array(BacklogIssueSchema).parse(payload);
    res.json(
      issues.map((item) => ({
        issueKey: item.issueKey,
        summary: item.summary,
        updatedAt: item.updated
      }))
    );
  } catch (error) {
    console.error('[backlog.issue_search_failed]', {
      mode,
      spaceUrl: session.spaceUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(502).json({ message: 'Issue search failed.' });
  }
});

app.get('/backlog/issues/:issueKey', async (req, res) => {
  const session = await getActiveSession(req);
  if (!session) {
    res.status(401).json({ message: 'Not authenticated.' });
    return;
  }

  const issueKey = req.params.issueKey?.trim();
  if (!issueKey) {
    res.status(400).json({ message: 'issueKey is required.' });
    return;
  }

  try {
    const payload = await backlogGet(session, `/api/v2/issues/${encodeURIComponent(issueKey)}`);
    const item = BacklogIssueSchema.parse(payload);
    res.json({
      issueKey: item.issueKey,
      summary: item.summary,
      descriptionRaw: item.description ?? '',
      updatedAt: item.updated,
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[backlog.issue_detail_failed]', {
      issueKey,
      spaceUrl: session.spaceUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(502).json({ message: 'Issue detail fetch failed.' });
  }
});

app.post('/auth/logout', (req, res) => {
  const sid = getCookieValue(req.headers.cookie, cookieName);
  if (sid) {
    const session = sessions.get(sid);
    if (session && !verifyCsrf(req, session.csrfToken)) {
      res.status(403).json({ message: 'Invalid CSRF token.' });
      return;
    }
  }
  if (sid) {
    sessions.delete(sid);
    pendingAuth.delete(sid);
  }
  clearSessionCookie(res);
  clearCsrfCookie(res);
  res.status(204).send();
});

function toAuthSessionResponse(session: AuthSession) {
  return AuthSessionSchema.parse({
    authenticated: true,
    spaceUrl: session.spaceUrl,
    expiresAt: new Date(session.expiresAt).toISOString(),
    user: session.user
  });
}

async function getActiveSession(req: express.Request): Promise<AuthSession | null> {
  const sid = getCookieValue(req.headers.cookie, cookieName);
  if (!sid) return null;

  const session = sessions.get(sid);
  if (!session) return null;

  if (session.expiresAt <= Date.now() + 5_000) {
    if (!session.refreshToken) {
      sessions.delete(sid);
      return null;
    }

    try {
      const refreshed = await exchangeToken({
        grantType: 'refresh_token',
        refreshToken: session.refreshToken,
        spaceUrl: session.spaceUrl
      });
      session.accessToken = refreshed.access_token;
      session.refreshToken = refreshed.refresh_token ?? session.refreshToken;
      session.expiresAt = Date.now() + refreshed.expires_in * 1000;
    } catch (error) {
      console.error('[oauth.refresh_failed]', {
        sid,
        spaceUrl: session.spaceUrl,
        error: error instanceof Error ? error.message : error
      });
      sessions.delete(sid);
      return null;
    }
  }

  return session;
}

async function backlogGet(session: AuthSession, path: string) {
  const url = new URL(path, session.spaceUrl);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('[backlog.api_failed]', {
      status: response.status,
      statusText: response.statusText,
      path,
      spaceUrl: session.spaceUrl,
      body
    });
    throw new Error(`Backlog API failed (${response.status}): ${body}`);
  }

  return response.json();
}

function normalizeSpaceUrl(spaceUrl: string) {
  const parsed = new URL(spaceUrl);
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function setSessionCookie(res: express.Response, sid: string) {
  const cookie = serializeCookie(cookieName, sid, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureCookie,
    path: '/',
    maxAge: 60 * 60
  });
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res: express.Response) {
  const cookie = serializeCookie(cookieName, '', {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureCookie,
    path: '/',
    maxAge: 0
  });
  res.setHeader('Set-Cookie', cookie);
}

function setCsrfCookie(res: express.Response, csrfToken: string) {
  const cookie = serializeCookie(csrfCookieName, csrfToken, {
    httpOnly: false,
    sameSite: 'Lax',
    secure: isSecureCookie,
    path: '/',
    maxAge: 60 * 60
  });
  appendSetCookie(res, cookie);
}

function clearCsrfCookie(res: express.Response) {
  const cookie = serializeCookie(csrfCookieName, '', {
    httpOnly: false,
    sameSite: 'Lax',
    secure: isSecureCookie,
    path: '/',
    maxAge: 0
  });
  appendSetCookie(res, cookie);
}

function appendSetCookie(res: express.Response, cookie: string) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }
  if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev, cookie]);
    return;
  }
  res.setHeader('Set-Cookie', [String(prev), cookie]);
}

function serializeCookie(
  name: string,
  value: string,
  opts: { httpOnly: boolean; sameSite: 'Lax' | 'Strict' | 'None'; secure: boolean; path: string; maxAge: number }
) {
  const items = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `Max-Age=${opts.maxAge}`,
    `SameSite=${opts.sameSite}`
  ];
  if (opts.httpOnly) items.push('HttpOnly');
  if (opts.secure) items.push('Secure');
  return items.join('; ');
}

function getCookieValue(rawCookie: string | undefined, name: string) {
  if (!rawCookie) return null;
  const cookies = rawCookie.split(';');
  for (const item of cookies) {
    const [key, ...valueParts] = item.trim().split('=');
    if (key === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return null;
}

function verifyCsrf(req: express.Request, expectedToken: string) {
  const cookieToken = getCookieValue(req.headers.cookie, csrfCookieName);
  const headerToken = getHeaderToken(req.headers['x-csrf-token']);
  if (!cookieToken || !headerToken) return false;
  if (!timingSafeEqualUtf8(cookieToken, headerToken)) return false;
  return timingSafeEqualUtf8(expectedToken, cookieToken);
}

function getHeaderToken(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return null;
}

function timingSafeEqualUtf8(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signState(payload: { sid: string; spaceUrl: string; exp: number }) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', stateSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyState(state: string): { sid: string; spaceUrl: string } | null {
  const [body, signature] = state.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', stateSecret).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(expected, actual)) return null;

  const parsed = z
    .object({
      sid: z.string().min(1),
      spaceUrl: z.string().url(),
      exp: z.number()
    })
    .safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));

  if (!parsed.success) return null;
  if (parsed.data.exp < Date.now()) return null;
  return { sid: parsed.data.sid, spaceUrl: parsed.data.spaceUrl };
}

async function exchangeToken(input: {
  grantType: 'authorization_code' | 'refresh_token';
  spaceUrl: string;
  code?: string;
  refreshToken?: string;
}) {
  const url = new URL('/api/v2/oauth2/token', input.spaceUrl);
  const params = new URLSearchParams();
  params.set('grant_type', input.grantType);
  params.set('client_id', process.env.BACKLOG_CLIENT_ID ?? '');
  params.set('client_secret', process.env.BACKLOG_CLIENT_SECRET ?? '');
  params.set('redirect_uri', process.env.BACKLOG_REDIRECT_URI ?? '');
  if (input.grantType === 'authorization_code') {
    params.set('code', input.code ?? '');
  } else {
    params.set('refresh_token', input.refreshToken ?? '');
  }

  const tokenRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('[oauth.token_exchange_failed]', {
      status: tokenRes.status,
      statusText: tokenRes.statusText,
      grantType: input.grantType,
      spaceUrl: input.spaceUrl,
      body
    });
    throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
  }

  const json = await tokenRes.json();
  return BacklogTokenResponseSchema.parse(json);
}

async function fetchBacklogUser(spaceUrl: string, accessToken: string) {
  const url = new URL('/api/v2/users/myself', spaceUrl);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('[oauth.user_fetch_failed]', {
      status: response.status,
      statusText: response.statusText,
      spaceUrl,
      body
    });
    throw new Error(`Backlog user fetch failed (${response.status}): ${body}`);
  }

  return BacklogUserSchema.parse(await response.json());
}

function validateBacklogSpaceUrl(spaceUrl: string): { ok: true; value: string } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(spaceUrl);
  } catch {
    return { ok: false, message: 'Invalid Space URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, message: 'Space URL must use https.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, message: 'Space URL must not include credentials.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!allowedBacklogHostSuffixes.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, message: 'Only Backlog domains are allowed.' };
  }
  if (host === 'backlog.com' || host === 'backlog.jp' || host === 'backlogtool.com') {
    return { ok: false, message: 'Space URL must include your space subdomain.' };
  }

  return { ok: true, value: parsed.toString() };
}

function clearExpired() {
  const now = Date.now();
  for (const [sid, pending] of pendingAuth.entries()) {
    if (pending.expiresAt < now) {
      pendingAuth.delete(sid);
    }
  }
  for (const [sid, session] of sessions.entries()) {
    if (session.expiresAt + 24 * 60 * 60 * 1000 < now) {
      sessions.delete(sid);
    }
  }
}

setInterval(clearExpired, 60_000).unref();

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error.' });
});

app.listen(port, () => {
  console.log(`[api] listening on :${port}`);
});
