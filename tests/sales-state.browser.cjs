'use strict';
// All browser requests are intercepted. No production API/Sheets access.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const oldTea = { VersionKey: 'T8307-B01', 'Primary Reference': 'T8307',
  '銘柄名（黒い本）': 'JASMIN GUANG XI', '茶種タグ': '緑茶', '産地・国': '中国',
  '香味大分類': '花', '香味詳細タグ': 'ジャスミン', '公式掲載状態': '未掲載', '現行ステータス': '終売未確定' };
const newTea = { ...oldTea, VersionKey: 'T8307-C01', '銘柄名（黒い本）': '',
  '現在の公式名': 'BLANC JASMIN', '茶種タグ': '白茶', '公式掲載状態': '掲載中', '現行ステータス': '販売中' };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api') {
        return route.fulfill({ contentType: 'application/javascript', body:
          url.searchParams.get('callback') + '(' + JSON.stringify({ ok: true, rows: [oldTea, newTea], updatedAt: '2026-10-04T00:00:00Z' }) + ');' });
      }
      if (url.pathname === '/app-config.js') {
        return route.fulfill({ contentType: 'application/javascript', body: 'window.MF_APP_CONFIG={GAS_API_URL:"https://mf.test/api"};' });
      }
      const files = { '/': 'index.html', '/index.html': 'index.html', '/sales-state.js': 'sales-state.js' };
      if (files[url.pathname]) return route.fulfill({ contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/html', body: fs.readFileSync(path.join(root, files[url.pathname])) });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('https://mf.test/');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
    assert.equal(await page.locator('#displayScope').inputValue(), 'shopping');
    assert.match(await page.locator('#list').innerText(), /BLANC JASMIN/);
    await page.selectOption('#displayScope', 'all');
    assert.equal(await page.locator('.card').count(), 2);
    assert.match(await page.locator('#list').innerText(), /旧版/);
    await page.selectOption('#tea', '緑茶');
    assert.equal(await page.locator('.card').count(), 1);
    assert.match(await page.locator('#list').innerText(), /JASMIN GUANG XI/);
    await page.click('#reset');
    assert.equal(await page.locator('#displayScope').inputValue(), 'shopping');
    await page.selectOption('#displayScope', 'past');
    assert.equal(await page.locator('.card').count(), 1);
    assert.match(await page.locator('#list').innerText(), /公式未掲載/);
    assert.equal(await page.locator('#end').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.selectOption('#displayScope', 'all');
    fs.mkdirSync(path.join(root, 'logs/sales-state-20261004'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'logs/sales-state-20261004/pwa-mobile.png'), fullPage: true });
    const unknown = { VersionKey: 'T999-B01', '現在の公式名': 'UNKNOWN LISTING', '現行ステータス': '販売中' };
    const migrationRows = [oldTea, newTea, unknown];
    await page.evaluate(rows => initData({ ok: true, rows, updatedAt: '2026-10-04' }), migrationRows);
    assert.equal(await page.locator('.card').count(), 2);
    assert.equal(await page.locator('#salesMigrationNotice').isVisible(), true);
    await page.evaluate(rows => initData({ ok: true, rows, updatedAt: '2026-10-04',
      salesStateMigration: { version: 1, complete: true } }), migrationRows);
    assert.equal(await page.locator('.card').count(), 1);
    assert.equal(await page.locator('#salesMigrationNotice').isVisible(), false);
    await page.selectOption('#displayScope', 'all');
    assert.equal(await page.locator('.card').count(), 3);
    assert.deepEqual(errors, []);
    console.log('PASS: Chrome mobile 390px; B01/C01 split, scopes, tea filter, reset, migration fallback/strict switch, no overflow or JS errors. All requests mocked.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
