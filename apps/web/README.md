# BaklogMD Web

Backlog OAuthで認証するWebクライアントです。

## 起動

```bash
npm install
npm run web:dev
```

## 環境変数

- `VITE_API_BASE_URL` (default: `http://localhost:3000`)

## ルーティング

- `/`: ログイン/セッション表示
- `/auth/callback`: Backlog OAuthコールバック受け取り
