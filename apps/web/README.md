# BaklogMD Web

Backlog OAuthでログインし、課題検索とMarkdownダウンロードを行うWebクライアントです。

## Features

- OAuthログイン / ログアウト
- セッション表示
- プロジェクト同期
- 課題検索（キーワード / 課題キー）
- 課題詳細表示
- Markdownダウンロード（Backlog記法の基本変換）

## Start

```bash
npm install
npm run web:dev
```

同時起動する場合（推奨）:

```bash
npm run webapi:dev
```

- Web default URL: `http://localhost:43174`

## Environment Variables

- `VITE_API_BASE_URL` (default: `http://localhost:43100`)
- `VITE_CSRF_COOKIE_NAME` (default: `baklogmd_csrf`)

## Routes

- `/`: ログイン/認証後UI
- `/auth/callback`: Backlog OAuthコールバック受信
