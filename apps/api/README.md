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
- `SESSION_COOKIE_NAME` (optional)
- `CSRF_COOKIE_NAME` (optional)

`OAUTH_STATE_SECRET` は32文字以上のランダム文字列を設定してください。

## Security Notes

- `spaceUrl` は `*.backlog.com` / `*.backlog.jp` / `*.backlogtool.com` のみ許可
- `POST` リクエストは `Origin` が `ALLOWED_ORIGINS` に含まれる場合のみ処理
- `POST /oauth/backlog/callback` と `POST /auth/logout` は double-submit CSRF で保護
- Backlog APIエラー詳細はサーバーログに記録し、クライアントには汎用メッセージのみ返却

## Cookie Names

- `SESSION_COOKIE_NAME`:
  - 認証済みセッションを識別するCookie名（例: `baklogmd_sid`）
  - 値はサーバー側セッションID
  - `httpOnly`で発行され、ブラウザJavaScriptからは読めない

- `CSRF_COOKIE_NAME`:
  - CSRF検証に使うCookie名（例: `baklogmd_csrf`）
  - 値はランダムCSRFトークン
  - Webクライアントが`X-CSRF-Token`ヘッダーへ載せるため、`httpOnly`ではない
