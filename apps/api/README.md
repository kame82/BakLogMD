# BaklogMD API

Backlog OAuthブローカー兼、Backlog代理APIです。

## Endpoints

- `GET /health`
- `GET /oauth/backlog/start`
- `POST /oauth/backlog/callback`
- `GET /auth/session`
- `POST /auth/logout`
- `GET /backlog/projects`
- `GET /backlog/issues/search`
- `GET /backlog/issues/:issueKey`

## Start

```bash
npm install
npm run api:dev
```

同時起動する場合（推奨）:

```bash
npm run webapi:dev
```

- API default URL: `http://localhost:43100`

## Environment Variables

`apps/api/.env.example` を `apps/api/.env` にコピーして設定します。

- `PORT` (default: `43100`)
- `BACKLOG_CLIENT_ID` (required)
- `BACKLOG_CLIENT_SECRET` (required)
- `BACKLOG_REDIRECT_URI` (required)
- `ALLOWED_ORIGINS` (required)
- `OAUTH_STATE_SECRET` (required, 32文字以上)
- `SESSION_COOKIE_NAME` (optional, default: `baklogmd_sid`)
- `CSRF_COOKIE_NAME` (optional, default: `baklogmd_csrf`)

## Security

- `spaceUrl` は `*.backlog.com` / `*.backlog.jp` / `*.backlogtool.com` のみ許可
- POSTは `Origin` が `ALLOWED_ORIGINS` に一致した場合のみ許可
- `POST /oauth/backlog/callback` と `POST /auth/logout` はdouble-submit CSRFで保護
- API失敗詳細はサーバーログに記録し、クライアントへは汎用エラーを返却
- Cookie用途は分離
- `SESSION_COOKIE_NAME`: 認証セッションID（httpOnly）
- `CSRF_COOKIE_NAME`: CSRFトークン（`X-CSRF-Token`と照合）
