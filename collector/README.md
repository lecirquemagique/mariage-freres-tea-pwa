# MARIAGE FRERES Image Collector

This collector is intentionally separate from the PWA. It opens official MARIAGE FRERES product pages with Playwright, keeps a collector-only persistent browser profile, and records image acquisition metadata.

Official MARIAGE FRERES image URLs are kept only in local audit logs. The tea master should receive Google Drive thumbnail URLs generated from images uploaded to the existing Drive folder:

```text
192M8W9aopop-k0H_xHMJBWkEVy3fK4eX
```

Images are organized by type:

```text
tea/T2301.jpg
tea-thumbnail/T2301.jpg
liqueur/TheBlanc1-Cream_1.png
```

Image types:

- `tea`: per-reference large tea leaf image, for example `t2301.jpg`.
- `teaThumbnail`: per-reference official 270p tea leaf thumbnail, for example `t2301-270p.jpg`.
- `liqueur`: shared color swatch from `media/contentmanager/content/...color_liqueur/...`.

Product catalog images such as `media/catalog/product/...-270p.jpg` are never liqueur images. They are accepted only as `teaThumbnail`, and only when the T reference matches exactly so `T230` and `T2301` cannot be mixed.

By default `config.example.json` uses Playwright's `channel: "chrome"` so Windows can launch the locally installed Google Chrome. The profile directory is `browser-profile` inside the collector working folder; it does not use or modify your normal Chrome profile.

## Setup

```powershell
cd C:\Users\nobuy\Documents\Codex\2026-08-29\github-main-feature-mf-image-collector\work\repo
npm install
copy collector\config.example.json config.json
```

`package.json` includes the required `playwright` dependency. When `browserChannel` is set to `chrome`, Playwright uses installed Google Chrome and does not need to download bundled Chromium for normal local runs.

Keep `.env`, browser profiles, logs, and downloaded images out of Git.

## First Chrome Verification Setup

Run this once in a normal Windows console:

```powershell
node collector\collector.js --config config.json --browser-channel chrome --auth-setup --debug --refs T2301,T2302
```

Chrome opens with the collector-only persistent profile at `browser-profile` inside this working folder. Complete any MARIAGE FRERES or Cloudflare verification in that window. When the real product page is visible, press Enter in the console. Cookies, local storage, cache, and browser state remain in the collector profile for later runs.

Do not point `profileDir` at your everyday Chrome user data directory.

## Manual Chrome With CDP

If Playwright-launched Chrome keeps repeating Cloudflare verification, start Chrome yourself from your normal Windows PowerShell or Command Prompt. This keeps Chrome on your interactive desktop and lets you complete verification manually.

Close any previous Chrome window that was started with the same debugging profile, then run one of these commands:

```powershell
.\collector\start-chrome-cdp.ps1
```

Or start Chrome directly:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$PWD\chrome-cdp-profile" --new-window "https://www.mariagefreres.com/fr/yin-zhen-t2301-thes-au-poids.html"
```

If Chrome is installed under `Program Files (x86)`:

```powershell
& "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$PWD\chrome-cdp-profile" --new-window "https://www.mariagefreres.com/fr/yin-zhen-t2301-thes-au-poids.html"
```

Complete Cloudflare verification in that Chrome window. You may also open the T2302 page in another tab:

```text
https://www.mariagefreres.com/fr/pai-mu-tan-imperial-t2302-thes-au-poids.html
```

Then leave Chrome open and run the collector in a second PowerShell:

```powershell
npm run collect:images:cdp
```

Or directly:

```powershell
node collector\collector.js --connect-cdp http://127.0.0.1:9222 --debug --refs T2301,T2302
```

In CDP mode, the collector does not launch Chrome. It connects to the already-running browser, reuses open product tabs when available, and otherwise opens new tabs inside that same manually verified Chrome.

When it reuses an already-open product tab, it reloads that tab once so CDP can capture fresh Network image response bodies. To inspect DOM/cache only without reloading, add `--no-reload-existing-pages`.

For the original two-product verification with detailed candidate output:

```powershell
npm run collect:images:cdp:debug
```

## Master Selection

The collector can read the current tea master through the same GAS JSONP endpoint used by the PWA:

1. `config.masterSource.gasApiUrl`
2. `MF_MASTER_GAS_API_URL`
3. `app-config.js` `GAS_API_URL`

The current API already exposes the columns needed for read-only selection:

- `Tリファレンス番号`
- `現在の公式名`
- `銘柄名（黒い本）`
- `茶葉画像URL`
- `水色画像URL`
- `公式商品ページURL`

Selection rules:

- Rows with both image URL columns populated are treated as `complete` and skipped.
- Rows with exactly one image URL populated are treated as `partial`.
- Rows with neither image URL populated are treated as `pending`.
- Local `collector-state.json` can also mark a reference as `complete`, `partial`, `retry`, or `error`.
- Each run processes at most `maxPerRun` products, default `5`.

Preview the next selected products without opening MARIAGE FRERES:

```powershell
npm run collect:images:dry-run
```

## Drive Upload And Sheet Writeback

The current Google Sheets columns are sufficient for image display writeback:

- `茶葉画像URL`
- `水色画像URL`
- `茶葉サムネイルURL`

The collector can POST acquired local images to a GAS endpoint. GAS saves the files to Drive, avoids duplicate file names according to `duplicatePolicy`, generates URLs such as:

```text
https://drive.google.com/thumbnail?id=<FILE_ID>&sz=w1200
```

Then GAS writes those URLs back to the existing master row. It does not write official `media/catalog/product/cache/...` URLs to the master.

Add `backend/mf-image-collector.gs` to the existing Apps Script project. If the project already has `doPost(e)`, do not create a second dispatcher; route only `action === 'uploadImageResults'` to `mfImageCollectorDoPost(e)`. If `茶葉サムネイルURL` is missing, the helper appends it once at the end of the master sheet.

In Apps Script project settings, set this Script Property:

```text
MF_COLLECTOR_WRITE_SECRET=<long random secret>
```

If the Apps Script is not bound to the tea master spreadsheet, also set:

```text
MF_MASTER_SPREADSHEET_ID=1QPMtFh4-FpeHuhA9ymYVJfwiXiNZhXUcNjgf0lrFO-0
```

In local PowerShell, store the same secret outside Git:

```powershell
$env:MF_COLLECTOR_WRITE_SECRET = "<same long random secret>"
```

Then enable writeback in `config.json`:

```json
{
  "drive": {
    "folderId": "192M8W9aopop-k0H_xHMJBWkEVy3fK4eX",
    "duplicatePolicy": "skip",
    "urlSize": "w1200"
  },
  "writeBack": {
    "enabled": true,
    "type": "gas",
    "gasApiUrl": "https://script.google.com/macros/s/.../exec",
    "secretEnv": "MF_COLLECTOR_WRITE_SECRET"
  }
}
```

Or keep `config.json` disabled and enable it only for a specific run:

```powershell
node collector\collector.js --connect-cdp http://127.0.0.1:9222 --refs T2301 --write-back
```

For normal hourly operation after the one-reference proof:

```powershell
npm run collect:images:cdp:writeback
```

`duplicatePolicy: "skip"` reuses an existing same-name file ID. `duplicatePolicy: "replace"` trashes same-name files and creates one replacement file, then rewrites the sheet URL to the new file ID.

Confirmed one-reference proof on 2026-08-29:

- T2301 images were acquired locally.
- `tea/T2301.jpg` was uploaded to Drive file ID `1xRiAKAz88A64m3rHmZzZXn89JyJe8w6O`.
- `tea-thumbnail/T2301.jpg` was uploaded to Drive file ID `1bLJEcFqehfkerkzwcAI_OFhhA9g5NlQV`.
- `liqueur/TheBlanc1-Cream_1.png` was uploaded to Drive file ID `1RZBle9GhPieELWibwcWQ2HzWDktBfMPZ`.
- The master row for T2301 was updated:
  - `茶葉画像URL`: `https://drive.google.com/thumbnail?id=1xRiAKAz88A64m3rHmZzZXn89JyJe8w6O&sz=w1200`
  - `茶葉サムネイルURL`: `https://drive.google.com/thumbnail?id=1bLJEcFqehfkerkzwcAI_OFhhA9g5NlQV&sz=w1200`
  - `水色画像URL`: `https://drive.google.com/thumbnail?id=1RZBle9GhPieELWibwcWQ2HzWDktBfMPZ&sz=w1200`
- The PWA reads these URLs into the T2301 image elements. Anonymous visual loading still requires Drive link-sharing to be enabled on the files.
- The previous incorrect `T2301_liqueur.jpg` file was renamed to `legacy_wrong_T2301_liqueur_catalog_270p.jpg`.

PWA display logic is not changed in this collector phase. A later PWA change can use `茶葉サムネイルURL` for list cards and `茶葉画像URL` for detail views.

Recommended optional audit columns, not required for the current writeback:

- `画像取得ステータス`
- `画像取得日時`
- `画像取得方法`
- `画像取得エラー`
- `画像取得リトライ回数`

## Test Run After Verification

```powershell
node collector\collector.js --config config.json --browser-channel chrome --debug --headed --refs T2301,T2302
```

Use `--headed` while stabilizing T2301/T2302. After the collector profile can load product pages reliably, you can try `--headless`; if the site challenges headless Chrome again, keep the scheduled command headed.

## Initial Findings

Confirmed product pages:

- T2301: `https://www.mariagefreres.com/fr/yin-zhen-t2301-thes-au-poids.html`
- T2302: `https://www.mariagefreres.com/fr/pai-mu-tan-imperial-t2302-thes-au-poids.html`

Confirmed from the rendered/crawled product pages:

- Both pages contain a primary tea leaf image near the product title.
- Both pages contain a `Liqueur` section with a liqueur image.

Observed in the Codex sandbox on 2026-08-29:

- Headless Playwright reached Cloudflare browser verification instead of the product DOM.
- Headed Playwright in the same sandbox also did not pass verification without manual browser interaction.
- The only image response captured before verification was Cloudflare challenge imagery, not product imagery.

This supports using a persistent headed Chrome profile for the first run. Once the browser profile has passed verification, later runs can reuse cookies, cache, and local storage and should prefer saved Network response bodies over direct image URL requests.

## Hourly Run

The collector exits after processing at most `maxPerRun` products. Schedule this command in Windows Task Scheduler every hour:

```powershell
.\collector\register-hourly-cdp-task.ps1 -WriteBack
```

The scheduled task calls `collector\run-cdp-once.ps1`, which checks that `http://127.0.0.1:9222` is available, then runs one collector pass. Keep the manual CDP Chrome open with `collector\start-chrome-cdp.ps1`.

Do not implement an infinite loop inside Node. Let Task Scheduler handle the hourly cadence.

## Result Logs

Each processed image writes a JSONL row with:

- `reference`
- `image_type`
- `source_page_url`
- `source_url`
- `resolved_url`
- `width`
- `height`
- `mime_type`
- `acquired_method`
- `acquired_at`
- `success`
- `error_message`

Statuses are stored in `collector-state.json`: `pending`, `partial`, `complete`, `retry`, or `error`.
