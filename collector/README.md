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

1. `MF_MASTER_GAS_API_URL`
2. `config.masterGasApiUrl`
3. `config.masterSource.gasApiUrl`
4. `app-config.js` `GAS_API_URL`

Normal collector runs require the master API. If the master cannot be read, the collector exits with an error instead of silently falling back to the fixed test products. Use `--use-config-products`, or set `masterSource.enabled` to `false`, only for explicit local tests against `config.json` products.

The current API already exposes the columns needed for read-only selection:

- `Tリファレンス番号`
- `現在の公式名`
- `銘柄名（黒い本）`
- `茶葉画像URL`
- `水色画像URL`
- `茶葉サムネイルURL`
- `茶葉画像状態`
- `茶葉サムネイル状態`
- `水色画像状態`
- `公式商品ページURL`

Selection rules:

- Rows where `tea`, `teaThumbnail`, and `liqueur` are all resolved are treated as `complete` and skipped.
- An image is resolved when its URL column is populated, or when its matching status column is `not_available`.
- Rows with some resolved images are treated as `partial`.
- Rows with no resolved images are treated as `pending`.
- Rows without `公式商品ページURL` are still eligible. The collector first searches the official site and writes the verified URL before collecting images.
- If `公式商品ページURL状態` is `not_available`, the row is skipped until the status is manually cleared or changed.
- Local `collector-state.json` can also mark a reference as `complete`, `partial`, `retry`, or `error`.
- Each run processes at most `maxPerRun` products, default `5`.

Preview the next selected products without opening MARIAGE FRERES:

```powershell
npm run collect:images:dry-run
```

To test only product URL discovery without image collection:

```powershell
node collector\collector.js --connect-cdp http://127.0.0.1:9222 --refs T2306,T238 --discover-urls-only --write-back
```

Product URL discovery uses the official site search in this order:

1. T reference number.
2. Current official name or black-book name.

The collector never writes a guessed product URL. It opens candidate official product pages and writes `公式商品ページURL` only when the visible product page text contains the exact T reference, so `T230` and `T2301` cannot be confused.

## Drive Upload And Sheet Writeback

The current Google Sheets columns are sufficient for image display writeback:

- `茶葉画像URL`
- `水色画像URL`
- `茶葉サムネイルURL`
- `公式商品ページURL状態`
- `茶葉画像状態`
- `茶葉サムネイル状態`
- `水色画像状態`

URL columns are for PWA display. Status columns are for collector scheduling and prevent infinite retries when an image is confirmed absent on the official page.

Status values:

- `available`: image exists and the Drive URL was written.
- `not_available`: the official page was checked and no valid candidate exists.
- `pending`: not processed yet.
- `error`: attempted but failed.

The collector can POST acquired local images to a GAS endpoint. GAS saves the files to Drive, avoids duplicate file names according to `duplicatePolicy`, generates URLs such as:

```text
https://drive.google.com/thumbnail?id=<FILE_ID>&sz=w1200
```

Then GAS writes those URLs back to the existing master row. It does not write official `media/catalog/product/cache/...` URLs to the master.

Add `backend/mf-image-collector.gs` to the existing Apps Script project. Do not create a second top-level `doPost(e)` if the project already has one; route only the collector actions to `mfImageCollectorDoPost(e)`. If `茶葉サムネイルURL` or the status columns are missing, the helper appends them once at the end of the master sheet.

If the existing Apps Script has no `doPost(e)`, add this small dispatcher:

```javascript
function doPost(e) {
  return mfImageCollectorDoPost(e);
}
```

If it already has `doPost(e)`, add this branch near the top of the existing function, after parsing the request JSON:

```javascript
if (payload.action === 'uploadImageResults') {
  return mfImageCollectorDoPost(e);
}
```

The same dispatcher must also route URL discovery writeback:

```javascript
if (payload.action === 'updateProductPageUrl') {
  return mfImageCollectorDoPost(e);
}
```

In Apps Script project settings, set this Script Property:

```text
MF_COLLECTOR_WRITE_SECRET=<long random secret>
```

If the Apps Script is not bound to the tea master spreadsheet, also set:

```text
MF_MASTER_SPREADSHEET_ID=1QPMtFh4-FpeHuhA9ymYVJfwiXiNZhXUcNjgf0lrFO-0
```

If the existing Apps Script already defines a global `SPREADSHEET_ID` constant, the collector helper uses that value automatically when `MF_MASTER_SPREADSHEET_ID` is not set.

In local PowerShell, store the same secret outside Git:

```powershell
$env:MF_COLLECTOR_WRITE_SECRET = "<same long random secret>"
```

Then enable writeback in `config.json`:

```json
{
  "masterGasApiUrl": "https://script.google.com/macros/s/.../exec",
  "drive": {
    "folderId": "192M8W9aopop-k0H_xHMJBWkEVy3fK4eX",
    "duplicatePolicy": "skip",
    "urlSize": "w1200"
  },
  "writeBack": {
    "enabled": true,
    "type": "gas",
    "gasApiUrl": "",
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

If `node` is not in PATH, pass the full executable path:

```powershell
.\collector\register-hourly-cdp-task.ps1 -WriteBack -NodeExe "C:\Program Files\nodejs\node.exe"
```

If `config.json` does not contain `masterSource.gasApiUrl` and `writeBack.gasApiUrl`, pass only the non-secret GAS endpoint. The run script exposes it to the collector as both `MF_MASTER_GAS_API_URL` and `MF_MASTER_WRITE_GAS_API_URL`. Keep `MF_COLLECTOR_WRITE_SECRET` in the user environment or `config.json`, not in the scheduled-task command:

```powershell
.\collector\register-hourly-cdp-task.ps1 -WriteBack -MasterGasApiUrl "https://script.google.com/macros/s/.../exec"
```

Do not implement an infinite loop inside Node. Let Task Scheduler handle the hourly cadence.

## Manual Start And Stop

For day-to-day operation, use the batch files in the repository root:

```text
画像回収_開始.bat
画像回収_停止.bat
画像回収_完全終了.bat
画像回収_ステータス.bat
```

`画像回収_開始.bat` checks whether the CDP Chrome endpoint is available. If it is not available, it starts the dedicated collector Chrome profile and waits for you to complete any Cloudflare verification. It then runs one collector pass immediately and registers the hourly scheduled task.

Before write-back starts, the launcher reads `MF_COLLECTOR_WRITE_SECRET` from the current process or the Windows user environment. If the secret is missing, it stops before processing images or touching Sheets.

`画像回収_停止.bat` disables the scheduled task so future hourly runs stop. It does not forcibly close the dedicated Chrome window and does not kill an active collector run by default; an active run can finish the current product safely.

`画像回収_完全終了.bat` disables future runs and also closes only the collector Chrome process that was started with the repository's `chrome-cdp-profile` and CDP port.

`画像回収_ステータス.bat` shows the scheduled task state, last/next run times, CDP Chrome availability, and a compact summary of recent local collector state.

Safety behavior:

- If CDP Chrome is not available, `run-cdp-once.ps1` exits before starting Node and before touching Sheets.
- If a previous collector run is still active, the next run exits without starting a second collector process.
- The scheduled task uses `MultipleInstances IgnoreNew`.
- The scheduled task is persistent. The collector does not delete or unregister it when there are no pending rows.
- If the PC is asleep, Task Scheduler can run the missed task after wake because `StartWhenAvailable` is enabled.
- If Cloudflare verification appears again, the product is marked as an error for that run; the collector does not loop or repeatedly reload forever.
- During manual start, if the initial run reports Cloudflare verification or another collector error, the hourly task is not registered. Complete verification in the dedicated Chrome window and run `画像回収_開始.bat` again.

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

Run statuses are stored in `collector-state.json`: `pending`, `partial`, `complete`, `retry`, or `error`. Per-image master statuses are stored in the three Sheets status columns as `available`, `not_available`, `pending`, or `error`.
