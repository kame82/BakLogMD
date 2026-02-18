# BaklogMD API

Backlog OAuthブローカーAPIです。

## 実装済みエンドポイント

- `GET /health`
- `GET /oauth/backlog/start`
- `POST /oauth/backlog/callback`
- `GET /auth/session`
- `POST /auth/logout`
- `GET /backlog/projects`
- `GET /backlog/issues/search`
- `GET /backlog/issues/:issueKey`

## 起動

```bash
npm install
npm run api:dev
```

## 必須設定

`apps/api/.env.example` を `.env` にコピーして値を設定してください。

- `BACKLOG_CLIENT_ID`
- `BACKLOG_CLIENT_SECRET`
- `BACKLOG_REDIRECT_URI`
- `ALLOWED_ORIGINS`
- `OAUTH_STATE_SECRET`
