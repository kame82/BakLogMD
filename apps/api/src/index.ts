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
};

type AuthSession = {
  sid: string;
  spaceUrl: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
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

const app = express();
const port = Number(process.env.PORT ?? 3000);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5174')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const stateSecret = process.env.OAUTH_STATE_SECRET ?? 'dev-only-change-me';
const cookieName = process.env.SESSION_COOKIE_NAME ?? 'baklogmd_sid';
const isSecureCookie = process.env.NODE_ENV === 'production';

const pendingAuth = new Map<string, PendingAuth>();
const sessions = new Map<string, AuthSession>();

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

  const spaceUrl = normalizeSpaceUrl(parsedSpaceUrl.data);
  const sid = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const state = signState({ sid, spaceUrl, exp: expiresAt });

  pendingAuth.set(sid, { sid, spaceUrl, expiresAt });
  clearExpired();
  setSessionCookie(res, sid);

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
    res.status(401).json({
      message: error instanceof Error ? error.message : 'OAuth callback failed.'
    });
  }
});

app.get('/auth/session', async (req, res) => {
  const sid = getCookieValue(req.headers.cookie, cookieName);
  if (!sid) {
    res.json(AuthSessionSchema.parse({ authenticated: false }));
    return;
  }

  const session = sessions.get(sid);
  if (!session) {
    res.json(AuthSessionSchema.parse({ authenticated: false }));
    return;
  }

  if (session.expiresAt <= Date.now() + 5_000) {
    if (!session.refreshToken) {
      sessions.delete(sid);
      res.json(AuthSessionSchema.parse({ authenticated: false }));
      return;
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
    } catch {
      sessions.delete(sid);
      res.json(AuthSessionSchema.parse({ authenticated: false }));
      return;
    }
  }

  res.json(
    AuthSessionSchema.parse({
      authenticated: true,
      spaceUrl: session.spaceUrl,
      expiresAt: new Date(session.expiresAt).toISOString(),
      user: session.user
    })
  );
});

app.post('/auth/logout', (req, res) => {
  const sid = getCookieValue(req.headers.cookie, cookieName);
  if (sid) {
    sessions.delete(sid);
    pendingAuth.delete(sid);
  }
  clearSessionCookie(res);
  res.status(204).send();
});

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

function signState(payload: { sid: string; spaceUrl: string; exp: number }) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', stateSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyState(state: string): { sid: string; spaceUrl: string } | null {
  const [body, signature] = state.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', stateSecret).update(body).digest('base64url');
  if (expected !== signature) return null;

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
