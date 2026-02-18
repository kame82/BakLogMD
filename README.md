# BaklogMD

Backlog連携アプリを1つのリポジトリで管理するアプリケーションです。

## Quick Start（Web）

```bash
npm install
npm run webapi:dev
```

- Web: `http://localhost:43174`
- API: `http://localhost:43100`

## Repo Layout

- `apps/desktop`: 既存Tauriデスクトップアプリ
- `apps/web`: Webクライアント（OAuthログイン、課題検索、Markdownダウンロード）
- `apps/api`: OAuthブローカー / Backlog代理API
- `packages/shared`: 共通型・バリデーション（Zod）

## Commands

```bash
npm run webapi:dev
npm run web:dev
npm run api:dev
npm run desktop:tauri
npm run build
```

## Docs

- Desktop: `apps/desktop/README.md`
- Web: `apps/web/README.md`
- API: `apps/api/README.md`

## Architecture

1. `apps/web` が `apps/api` に接続してOAuthを開始
2. `apps/api` が Backlog OAuth / Backlog API を代理実行
3. `client_secret` は `apps/api` のみ保持
4. セッションはCookieで管理し、POSTはCSRF保護

## Security Snapshot

- `client_secret` はサーバーのみ保持
- Backlog Space URL は許可ドメインに制限
- 更新系POSTは `Origin` 検証 + double-submit CSRF
- Cookieを用途分離
- `SESSION_COOKIE_NAME`: 認証セッションID
- `CSRF_COOKIE_NAME`: CSRF検証トークン
