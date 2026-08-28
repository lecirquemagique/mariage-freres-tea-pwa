# MARIAGE FRERES Image Collector

This collector is intentionally separate from the PWA. It opens official MARIAGE FRERES product pages with Playwright, keeps a collector-only persistent browser profile, and records image acquisition metadata that can later be joined back to the tea master fields `茶葉画像URL` and `水色画像URL`.

By default `config.example.json` uses Playwright's `channel: "chrome"` so Windows can launch the locally installed Google Chrome. The profile directory is `browser-profile` inside the collector working folder; it does not use or modify your normal Chrome profile.

## Setup

```powershell
cd C:\MF-Image-Collector
npm install
copy collector\config.example.json config.json
```

`package.json` includes the required `playwright` dependency. When `browserChannel` is set to `chrome`, Playwright uses installed Google Chrome and does not need to download bundled Chromium for normal local runs.

No API keys or credentials are required by the collector. Keep `.env`, browser profiles, logs, and downloaded images out of Git.

## First Chrome Verification Setup

Run this once in a normal Windows console:

```powershell
node collector\collector.js --config config.json --browser-channel chrome --auth-setup --debug --refs T2301,T2302
```

Chrome opens with the collector-only persistent profile at `C:\MF-Image-Collector\browser-profile`. Complete any MARIAGE FRERES or Cloudflare verification in that window. When the real product page is visible, press Enter in the console. Cookies, local storage, cache, and browser state remain in the collector profile for later runs.

Do not point `profileDir` at your everyday Chrome user data directory.

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
node C:\MF-Image-Collector\collector\collector.js --config C:\MF-Image-Collector\config.json --browser-channel chrome
```

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
