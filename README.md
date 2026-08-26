# MARIAGE FRÈRES Tea PWA

## GitHub Pages
このリポジトリ直下を GitHub Pages で公開します。

1. `app-config.js` の `GAS_API_URL` に、Apps Script Webアプリの `/exec` URLを設定。
2. Settings → Pages → Deploy from a branch → `main` / `(root)` → Save。
3. 発行されたURLをiPhoneのSafariで開き、「共有」→「ホーム画面に追加」。

## Backend
`backend/Code.gs` を銘柄マスターの Apps Script に貼り付け、Webアプリとしてデプロイします。
