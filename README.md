# BaklogMD

Backlog連携アプリを1つのリポジトリで管理するアプリケーションです。

## このリポジトリにあるアプリ

- `apps/web`: Webアプリ（OAuthログイン、課題検索、Markdownダウンロード）
- `apps/desktop`: Tauriデスクトップアプリ（ローカル利用向け）

補足: Webアプリは `apps/api`（OAuthブローカー/API）とセットで動作します。

## セットアップ

```bash
npm install
```

## 事前設定（Web + API向け）

`apps/web` を動かす前に `apps/api/.env` の設定が必要です。

```bash
cp apps/api/.env.example apps/api/.env
```

最低限、以下を設定してください。

- `BACKLOG_CLIENT_ID`
- `BACKLOG_CLIENT_SECRET`
- `BACKLOG_REDIRECT_URI`（通常: `http://localhost:43174/auth/callback`）
- `ALLOWED_ORIGINS`（通常: `http://localhost:43174`）
- `OAUTH_STATE_SECRET`（32文字以上のランダム文字列）

## 事前設定（Desktop向け）

`apps/desktop` は Web/API の `.env` とは別系統です。  
Rust/Tauriの事前準備は [apps/desktop/README.md](apps/desktop/README.md) に従って設定してください。

## Webアプリの起動

推奨（Web + APIを同時起動）:

```bash
npm run webapi:dev
```

- Web: `http://localhost:43174`
- API: `http://localhost:43100`

個別起動する場合:

```bash
npm run api:dev
npm run web:dev
```

## デスクトップアプリの起動

```bash
npm run desktop:tauri
```

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

- Desktop: [apps/desktop/README.md](apps/desktop/README.md)
- Web: [apps/web/README.md](apps/web/README.md)
- API: [apps/api/README.md](apps/api/README.md)

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
