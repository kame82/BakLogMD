# BaklogMD Monorepo

Backlog連携アプリ群を1つのモノレポで管理する構成です。

## Structure

- `apps/desktop`: 既存Tauriデスクトップアプリ
- `apps/web`: Webフロントエンド（新規）
- `apps/api`: OAuthブローカー/APIサーバー（新規）
- `packages/shared`: 型・バリデーション・共通ロジック

## Tech Stack

- `apps/desktop`: React + TypeScript + Vite + Tauri (Rust) + SQLite + Keychain
- `apps/web`: React + TypeScript + Vite
- `apps/api`: Node.js + Express + TypeScript + Helmet + CORS + dotenv
- `packages/shared`: TypeScript + Zod
- Monorepo: npm workspaces

## Architecture

1. `apps/web` は `apps/api` にHTTPで接続してOAuthを実行します。
2. `apps/api` が Backlog OAuth と Backlog API を代理実行し、`client_secret`を保持します。
3. セッションは `apps/api` 発行の `httpOnly` Cookie で管理します（`apps/web`は`credentials: include`で送受信）。
4. `packages/shared` は `apps/web` と `apps/api` の共通型/バリデーションを提供します。
5. `apps/desktop` は現時点では独立実装（APIキー方式）で、今後ブローカー経由へ統合予定です。

## Setup

```bash
npm install
```

## Common Commands

```bash
npm run desktop:tauri
npm run web:dev
npm run api:dev
npm run build
```

## App Docs

- Desktopセットアップ/運用手順: `apps/desktop/README.md`
- Webクライアント手順: `apps/web/README.md`
- OAuthブローカーAPI手順: `apps/api/README.md`

## Security Direction

- Backlogの`client_secret`は`apps/api`でのみ保持
- `apps/web`/`apps/desktop`はブローカー経由で認証
- 共通の入力バリデーションは`packages/shared`で一元化
