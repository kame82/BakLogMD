# BaklogMD API

Backlog OAuthブローカーAPIです。

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
