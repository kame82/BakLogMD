# macOS 配布手順（手動署名 + Notarization）

## 1. 前提

- Apple Developer Program 契約済み
- Developer ID Application 証明書インストール済み
- Xcode command line tools 利用可能

## 2. ビルド

```bash
npm install
npm run tauri build
```

## 3. 署名確認

```bash
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/*.app
```

## 4. Notarization

1. `xcrun notarytool` 用のプロファイルを設定
2. DMGを送信

```bash
xcrun notarytool submit src-tauri/target/release/bundle/dmg/*.dmg --keychain-profile <PROFILE> --wait
```

3. ステープル

```bash
xcrun stapler staple src-tauri/target/release/bundle/dmg/*.dmg
```

## 5. 社内配布

- Notarization済みDMGを社内Wikiへ掲載
- インストール手順と初期設定手順を同ページに記載
