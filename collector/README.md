# MARIAGE FRERES Image Collector

This collector is intentionally separate from the PWA. It opens official MARIAGE FRERES product pages with Playwright Chromium, keeps a persistent browser profile, and records image acquisition metadata that can later be joined back to the tea master fields `茶葉画像URL` and `水色画像URL`.

## Setup

```powershell
cd C:\MF-Image-Collector
npm install
copy collector\config.example.json config.json
```

No API keys or credentials are required by the collector. Keep `.env`, browser profiles, logs, and downloaded images out of Git.

## Test Run

```powershell
node collector\collector.js --config config.json --debug --headed --refs T2301,T2302
```

Use `--headed` for the first runs. The site may present browser verification, and the persistent `browser-profile` directory lets cookies, cache, and local storage survive future executions.

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

This supports using a persistent headed Chromium profile for the first run. Once the browser profile has passed verification, later runs can reuse cookies, cache, and local storage and should prefer saved Network response bodies over direct image URL requests.

## Hourly Run

The collector exits after processing at most `maxPerRun` products. Schedule this command in Windows Task Scheduler every hour:

```powershell
node C:\MF-Image-Collector\collector\collector.js --config C:\MF-Image-Collector\config.json
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
