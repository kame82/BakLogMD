import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { APP_NAME } from '@baklogmd/shared';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins.length === 0 ? false : allowedOrigins,
    credentials: true
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, app: APP_NAME, service: 'oauth-broker-api' });
});

// OAuth開始URLを返す。client_secretはこのAPI内のみで扱う。
app.get('/oauth/backlog/start', (_req, res) => {
  if (!process.env.BACKLOG_CLIENT_ID || !process.env.BACKLOG_REDIRECT_URI) {
    res.status(500).json({ message: 'Backlog OAuth env is not configured' });
    return;
  }

  res.status(501).json({
    message: 'Not implemented yet',
    next: 'Build state/nonce generation and redirect URL response'
  });
});

app.post('/oauth/backlog/callback', (_req, res) => {
  if (!process.env.BACKLOG_CLIENT_SECRET) {
    res.status(500).json({ message: 'Backlog client secret is missing' });
    return;
  }

  res.status(501).json({
    message: 'Not implemented yet',
    next: 'Exchange authorization code and create app session'
  });
});

app.listen(port, () => {
  console.log(`[api] listening on :${port}`);
});
