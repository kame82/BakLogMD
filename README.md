# BaklogMD Monorepo

Backlog連携アプリ群を1つのモノレポで管理する構成です。

## Structure

- `apps/desktop`: 既存Tauriデスクトップアプリ
- `apps/web`: Webフロントエンド（新規）
- `apps/api`: OAuthブローカー/APIサーバー（新規）
- `packages/shared`: 型・バリデーション・共通ロジック

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

## Security Direction

- Backlogの`client_secret`は`apps/api`でのみ保持
- `apps/web`/`apps/desktop`はブローカー経由で認証
- 共通の入力バリデーションは`packages/shared`で一元化
