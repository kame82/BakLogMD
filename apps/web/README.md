# BaklogMD Web

Backlog OAuthで認証するWebクライアントです。

## 実装済み機能

- OAuthログイン / ログアウト
- 認証後セッション表示
- プロジェクト同期表示
- 課題検索（キーワード / 課題キー）
- 課題詳細表示
- Markdownダウンロード（Backlog記法の基本変換あり）

## 起動

```bash
npm install
npm run web:dev
```

## 環境変数

- `VITE_API_BASE_URL` (default: `http://localhost:3000`)

## ルーティング

- `/`: ログイン/認証後UI（プロジェクト・課題検索・課題詳細）
- `/auth/callback`: Backlog OAuthコールバック受け取り
