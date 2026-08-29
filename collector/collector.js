#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_CONFIG = 'config.json';
const IMAGE_TYPES = ['tea', 'teaThumbnail', 'liqueur'];
const IMAGE_TYPE_FOLDERS = {
  tea: 'tea',
  teaThumbnail: 'tea-thumbnail',
  liqueur: 'liqueur',
};
const DRIVE_THUMBNAIL_SIZE = 'w1200';
const MASTER_COLUMNS = {
  reference: 'Tリファレンス番号',
  name: '現在の公式名',
  fallbackName: '銘柄名（黒い本）',
  teaImageUrl: '茶葉画像URL',
  teaThumbnailUrl: '茶葉サムネイルURL',
  liqueurImageUrl: '水色画像URL',
  teaImageStatus: '茶葉画像状態',
  teaThumbnailStatus: '茶葉サムネイル状態',
  liqueurImageStatus: '水色画像状態',
  productUrl: '公式商品ページURL',
  productUrlStatus: '公式商品ページURL状態',
};
const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
};

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG,
    debug: false,
    headed: false,
    headless: null,
    authSetup: false,
    browserChannel: null,
    connectCdp: null,
    useExistingPages: false,
    reloadExistingPages: true,
    dryRun: false,
    writeBack: null,
    useConfigProducts: false,
    discoverUrlsOnly: false,
    refs: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--debug') args.debug = true;
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--headless') args.headless = true;
    else if (arg === '--auth-setup') args.authSetup = true;
    else if (arg === '--browser-channel') args.browserChannel = argv[++i];
    else if (arg.startsWith('--browser-channel=')) args.browserChannel = arg.slice('--browser-channel='.length);
    else if (arg === '--connect-cdp') args.connectCdp = argv[++i];
    else if (arg.startsWith('--connect-cdp=')) args.connectCdp = arg.slice('--connect-cdp='.length);
    else if (arg === '--use-existing-pages') args.useExistingPages = true;
    else if (arg === '--no-reload-existing-pages') args.reloadExistingPages = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--write-back') args.writeBack = true;
    else if (arg === '--no-write-back') args.writeBack = false;
    else if (arg === '--use-config-products') args.useConfigProducts = true;
    else if (arg === '--discover-urls-only') args.discoverUrlsOnly = true;
    else if (arg === '--config') args.config = argv[++i];
    else if (arg.startsWith('--config=')) args.config = arg.slice('--config='.length);
    else if (arg === '--refs') args.refs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--refs=')) args.refs = arg.slice('--refs='.length).split(',').map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readOptionalText(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay({ min = 4000, max = 14000 } = {}) {
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

function resolveProjectPath(baseDir, value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.join(baseDir, value);
}

function sanitizeReference(reference) {
  return String(reference || '').replace(/[^A-Za-z0-9_-]+/g, '_');
}

function extensionForMime(mimeType, fallbackUrl = '') {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXT[normalized]) return MIME_EXT[normalized];
  const match = String(fallbackUrl).match(/\.(jpe?g|png|webp|avif|gif)(?:[?#]|$)/i);
  return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : '.bin';
}

function basenameFromUrl(rawUrl) {
  try {
    const pathname = new URL(rawUrl).pathname;
    return path.basename(decodeURIComponent(pathname)).replace(/[^A-Za-z0-9._-]+/g, '_');
  } catch {
    return '';
  }
}

function normalizeUrl(raw, baseUrl) {
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return '';
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function hasValue(value) {
  return normalizeText(value).length > 0;
}

function normalizeImageStatus(value) {
  const status = normalizeText(value).toLowerCase();
  return ['available', 'not_available', 'pending', 'error'].includes(status) ? status : '';
}

function normalizeProductUrlStatus(value) {
  const status = normalizeText(value).toLowerCase();
  if (status === 'not_available') return 'not_found';
  return ['available', 'not_found', 'pending', 'error'].includes(status) ? status : '';
}

function gasJsonpUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('action', 'teaData');
  url.searchParams.set('callback', '__mfCollectorCb');
  url.searchParams.set('_', String(Date.now()));
  return url.href;
}

function driveThumbnailUrl(fileId, size = DRIVE_THUMBNAIL_SIZE) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=${encodeURIComponent(size)}`;
}

function responsePreview(text, maxLength = 300) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function formatWriteBackResponseError(message, settings, response, text) {
  const details = {
    post_url: settings.gasApiUrl,
    final_url: response.url,
    http_status: response.status,
    content_type: response.headers.get('content-type') || '',
    redirected: response.redirected,
    response_start: responsePreview(text),
  };
  return `${message}: ${JSON.stringify(details)}`;
}

function getWriteBackSettings(config, baseDir) {
  const writeBack = config.writeBack || {};
  if (writeBack.enabled !== true) return null;

  const gasApiUrl =
    writeBack.gasApiUrl ||
    process.env.MF_MASTER_WRITE_GAS_API_URL ||
    config.masterGasApiUrl ||
    config.masterSource?.gasApiUrl ||
    findGasUrlFromAppConfig(baseDir);

  if (!gasApiUrl) throw new Error('writeBack.enabled is true, but no GAS API URL is configured.');

  const secretEnv = writeBack.secretEnv || 'MF_COLLECTOR_WRITE_SECRET';
  const secret = process.env[secretEnv] || '';
  if (!secret) throw new Error(`writeBack.enabled is true, but ${secretEnv} is not set.`);

  return {
    gasApiUrl,
    secret,
    folderId: config.drive?.folderId || writeBack.folderId || '',
    duplicatePolicy: config.drive?.duplicatePolicy || writeBack.duplicatePolicy || 'skip',
    urlSize: config.drive?.urlSize || writeBack.urlSize || DRIVE_THUMBNAIL_SIZE,
  };
}

function encodeImageForWriteBack(row, imageType) {
  if (!row) return null;
  const status = row.success ? 'available' : row.not_available ? 'not_available' : 'error';
  const payload = {
    image_type: imageType,
    folder_key: IMAGE_TYPE_FOLDERS[imageType] || imageType,
    status,
    error_message: row.error_message || '',
    source_url: row.source_url || '',
    resolved_url: row.resolved_url || '',
    file_name: row.file_path ? path.basename(row.file_path) : '',
    mime_type: row.mime_type || 'application/octet-stream',
    width: row.width || 0,
    height: row.height || 0,
    acquired_method: row.acquired_method || '',
  };
  if (row.success && row.file_path && fs.existsSync(row.file_path)) {
    payload.data_base64 = fs.readFileSync(row.file_path).toString('base64');
  }
  return payload;
}

async function writeBackImageResults({ config, baseDir, product, result, debug }) {
  const settings = getWriteBackSettings(config, baseDir);
  if (!settings) return null;

  const images = IMAGE_TYPES
    .map((imageType) => encodeImageForWriteBack(result.images?.[imageType], imageType))
    .filter(Boolean);

  if (images.length === 0) {
    if (debug) console.log(`[writeback] ${product.reference} skipped: no successful local images`);
    return null;
  }

  const payload = {
    action: 'uploadImageResults',
    secret: settings.secret,
    reference: product.reference,
    folder_id: settings.folderId,
    duplicate_policy: settings.duplicatePolicy,
    url_size: settings.urlSize,
    images,
  };

  if (debug) {
    const imageLabels = images
      .map((image) => `${image.image_type}:${image.folder_key || image.image_type}/${image.file_name}`)
      .join(', ');
    console.log(`[writeback] ${product.reference} uploading ${imageLabels}`);
  }

  const response = await fetch(settings.gasApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(formatWriteBackResponseError('Writeback did not return JSON', settings, response, text));
  }
  if (!response.ok || data.ok === false) {
    throw new Error(formatWriteBackResponseError(`Writeback failed: ${data.error || responsePreview(text)}`, settings, response, text));
  }

  for (const image of data.images || []) {
    const row = result.images?.[image.image_type];
    if (!row) continue;
    row.drive_file_id = image.file_id || '';
    row.drive_url = image.url || (image.file_id ? driveThumbnailUrl(image.file_id, settings.urlSize) : '');
    row.drive_action = image.action || '';
  }
  result.writeBack = {
    success: true,
    updated_at: nowIso(),
    sheet_row: data.sheet_row || 0,
    images: data.images || [],
  };
  return result.writeBack;
}

async function writeBackProductPageUrl({ config, baseDir, product, discovery, debug }) {
  const settings = getWriteBackSettings(config, baseDir);
  if (!settings) return null;

  const payload = {
    action: 'updateProductPageUrl',
    secret: settings.secret,
    reference: product.reference,
    product_page_url: discovery.url || '',
    status: discovery.success ? 'available' : normalizeProductUrlStatus(discovery.status) || 'error',
    error_message: discovery.error_message || '',
  };

  if (debug) {
    console.log(`[url-writeback] ${product.reference} status=${payload.status} url=${payload.product_page_url}`);
  }

  const response = await fetch(settings.gasApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(formatWriteBackResponseError('Product URL writeback did not return JSON', settings, response, text));
  }
  if (!response.ok || data.ok === false) {
    throw new Error(formatWriteBackResponseError(`Product URL writeback failed: ${data.error || responsePreview(text)}`, settings, response, text));
  }
  return {
    success: true,
    updated_at: nowIso(),
    sheet_row: data.sheet_row || 0,
    status: data.status || payload.status,
    url: data.product_page_url || payload.product_page_url,
  };
}

function parseJsonp(text, callbackName = '__mfCollectorCb') {
  const trimmed = text.trim();
  const prefix = `${callbackName}(`;
  if (!trimmed.startsWith(prefix)) {
    throw new Error('GAS response was not JSONP. Expected callback wrapper.');
  }
  const json = trimmed.endsWith(';')
    ? trimmed.slice(prefix.length, -2)
    : trimmed.slice(prefix.length, -1);
  return JSON.parse(json);
}

function findGasUrlFromAppConfig(baseDir) {
  const appConfig = readOptionalText(path.join(baseDir, 'app-config.js'));
  return appConfig.match(/GAS_API_URL:\s*['"]([^'"]+)['"]/)?.[1] || '';
}

async function fetchMasterProducts(config, baseDir, debug) {
  const source = config.masterSource || {};
  if (source.enabled === false) return null;

  const gasApiUrl =
    process.env.MF_MASTER_GAS_API_URL ||
    config.masterGasApiUrl ||
    source.gasApiUrl ||
    findGasUrlFromAppConfig(baseDir);

  if (!gasApiUrl || gasApiUrl.includes('PASTE_YOUR')) {
    throw new Error('Master GAS API URL is required. Set MF_MASTER_GAS_API_URL or config.masterGasApiUrl. Use --use-config-products only for explicit local tests.');
  }

  const url = gasJsonpUrl(gasApiUrl);
  if (debug) console.log(`[master] fetch ${url.replace(/_=\d+/, '_=<timestamp>')}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Master GAS API returned HTTP ${response.status}`);

  const payload = parseJsonp(await response.text());
  if (!payload || payload.ok !== true || !Array.isArray(payload.rows)) {
    throw new Error('Master GAS API returned an invalid teaData payload.');
  }

  const products = payload.rows
    .map((row) => {
      const reference = normalizeText(row[MASTER_COLUMNS.reference]);
      const productUrl = normalizeText(row[MASTER_COLUMNS.productUrl]);
      if (!reference) return null;
      return {
        reference,
        name: normalizeText(row[MASTER_COLUMNS.name]) || normalizeText(row[MASTER_COLUMNS.fallbackName]),
        productUrl,
        master: {
          productUrl,
          productUrlStatus: normalizeProductUrlStatus(row[MASTER_COLUMNS.productUrlStatus]),
          teaImageUrl: normalizeText(row[MASTER_COLUMNS.teaImageUrl]),
          teaThumbnailUrl: normalizeText(row[MASTER_COLUMNS.teaThumbnailUrl]),
          liqueurImageUrl: normalizeText(row[MASTER_COLUMNS.liqueurImageUrl]),
          teaImageStatus: normalizeImageStatus(row[MASTER_COLUMNS.teaImageStatus]),
          teaThumbnailStatus: normalizeImageStatus(row[MASTER_COLUMNS.teaThumbnailStatus]),
          liqueurImageStatus: normalizeImageStatus(row[MASTER_COLUMNS.liqueurImageStatus]),
        },
      };
    })
    .filter(Boolean);

  if (debug) {
    const productsWithUrls = products.filter((product) => hasValue(product.productUrl)).length;
    console.log(`[master] rows=${payload.rows.length} products=${products.length} productsWithUrls=${productsWithUrls} updatedAt=${payload.updatedAt || ''}`);
  }
  return { products, updatedAt: payload.updatedAt || '', rowCount: payload.rows.length };
}

function isProbablyImageUrl(url) {
  return /\.(avif|webp|png|jpe?g|gif)(?:[?#]|$)/i.test(url || '');
}

function referenceRegex(reference) {
  const escaped = String(reference || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
}

function candidateHasExactReference(candidate, product) {
  const re = referenceRegex(product.reference);
  const hay = [
    candidate.url,
    candidate.sourceUrl,
    candidate.alt,
    candidate.title,
    candidate.closestText,
    candidate.sectionText,
  ].join(' ');
  return re.test(hay);
}

function candidateReferenceTokens(candidate) {
  const hay = [
    candidate.url,
    candidate.sourceUrl,
    candidate.alt,
    candidate.title,
    candidate.closestText,
    candidate.sectionText,
  ].join(' ');
  return [...new Set([...hay.matchAll(/(^|[^a-z0-9])(t\d{2,5}|tp\d{2,5})([^a-z0-9]|$)/gi)].map((match) => match[2].toUpperCase()))];
}

function candidateHasConflictingReference(candidate, product) {
  const expected = String(product.reference || '').toUpperCase();
  return candidateReferenceTokens(candidate).some((token) => token !== expected);
}

function candidateHaystack(candidate) {
  return [
    candidate.url,
    candidate.sourceUrl,
    candidate.alt,
    candidate.title,
    candidate.id,
    candidate.className,
    candidate.closestText,
    candidate.sectionText,
    candidate.sourceKind,
  ].join(' ').toLowerCase();
}

function isColorLiqueurCandidate(candidate) {
  return /(^|\/|_)color_liqueur(\/|_|$)/i.test(candidate.url || '') ||
    /color_liqueur/i.test(candidateHaystack(candidate));
}

function isCatalogProductCandidate(candidate) {
  return /media\/catalog\/product/i.test(candidate.url || '') ||
    /media\/catalog\/product/i.test(candidateHaystack(candidate));
}

function isTeaThumbnailCandidate(candidate, product) {
  if (!candidateHasExactReference(candidate, product)) return false;
  const reference = String(product.reference || '').toLowerCase();
  const url = String(candidate.url || '').toLowerCase();
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return isCatalogProductCandidate(candidate) &&
    new RegExp(`(^|/)${escaped}-\\d+p\\.(jpe?g|png|webp|avif)(?:[?#]|$)`, 'i').test(url);
}

function classifyCandidate(candidate, product, imageType) {
  const reference = String(product.reference || '').toLowerCase();
  const name = String(product.name || '').toLowerCase();
  const hay = candidateHaystack(candidate);

  let score = 0;
  let reject = 0;

  if (imageType !== 'liqueur' && candidateHasConflictingReference(candidate, product)) reject += 50;
  if (candidateHasExactReference(candidate, product)) score += imageType === 'liqueur' ? 1 : 10;
  if (name && hay.includes(name)) score += 2;
  if (hay.includes('/cache/')) score += 1;
  if ((candidate.width || 0) >= 180 && (candidate.height || 0) >= 180) score += 2;
  if ((candidate.naturalWidth || 0) >= 180 && (candidate.naturalHeight || 0) >= 180) score += 2;

  if (imageType === 'liqueur') {
    if (isColorLiqueurCandidate(candidate)) score += 100;
    if (/liqueur|liquor|liquore/.test(hay)) score += 10;
    if (isCatalogProductCandidate(candidate)) reject += 80;
    if (/\/t\/\d\/t\d{2,5}-\d+p\.(jpe?g|png|webp|avif)(?:[?#]|$)/i.test(candidate.url || '')) reject += 100;
  } else if (imageType === 'teaThumbnail') {
    if (isTeaThumbnailCandidate(candidate, product)) score += 100;
    if (isColorLiqueurCandidate(candidate)) reject += 100;
    if (!/-\d+p\.(jpe?g|png|webp|avif)(?:[?#]|$)/i.test(candidate.url || '')) reject += 25;
  } else {
    if (hay.includes('media/catalog/product')) score += 4;
    if (/-\d+p\.(jpe?g|png|webp|avif)(?:[?#]|$)/i.test(candidate.url || '')) reject += 15;
    if (/liqueur|liquor|liquore|color_liqueur/.test(hay)) reject += 8;
    if (/thes-au-poids|tea-by-the-weight|te-al-peso/.test(hay)) score += 2;
    if (candidateHasExactReference(candidate, product) && /t\d{2,5}(-\d+p)?\.(jpe?g|png|webp|avif)/.test(hay)) score += 5;
  }

  if (/logo|payment|paiement|livraison|delivery|shipping|secure|sprite|icon|favicon|jardin/.test(hay)) reject += 10;
  if ((candidate.width || 0) > 0 && (candidate.width || 0) < 80) reject += 4;
  if ((candidate.height || 0) > 0 && (candidate.height || 0) < 80) reject += 4;

  return score - reject;
}

function pickCandidate(candidates, product, imageType) {
  const dimensionsByUrl = new Map();
  for (const candidate of candidates) {
    if (!candidate.url) continue;
    const previous = dimensionsByUrl.get(candidate.url) || {};
    dimensionsByUrl.set(candidate.url, {
      width: Math.max(previous.width || 0, candidate.width || 0),
      height: Math.max(previous.height || 0, candidate.height || 0),
      naturalWidth: Math.max(previous.naturalWidth || 0, candidate.naturalWidth || 0),
      naturalHeight: Math.max(previous.naturalHeight || 0, candidate.naturalHeight || 0),
    });
  }
  const scoredAll = candidates
    .map((candidate) => ({
      ...candidate,
      ...dimensionsByUrl.get(candidate.url),
      score: classifyCandidate(candidate, product, imageType),
    }))
    .filter((candidate) => candidate.url && candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  if (imageType === 'liqueur') {
    return scoredAll.find((candidate) => isColorLiqueurCandidate(candidate)) || null;
  }
  if (imageType === 'teaThumbnail') {
    return scoredAll.find((candidate) => isTeaThumbnailCandidate(candidate, product)) || null;
  }
  const exact = scoredAll.filter((candidate) => candidateHasExactReference(candidate, product));
  return exact[0] || null;
}

function pageMatchesProduct(page, product) {
  const pageUrl = page.url();
  const productUrl = String(product.productUrl || '').toLowerCase();
  return pageUrl.toLowerCase() === productUrl || referenceRegex(product.reference).test(pageUrl);
}

async function getProductPage(context, product, { useExistingPages = false } = {}) {
  const existing = context.pages().find((page) => pageMatchesProduct(page, product));
  if (existing && useExistingPages) return { page: existing, shouldClose: false, reused: true };
  return { page: await context.newPage(), shouldClose: true, reused: false };
}

function normalizeSearchTerm(value) {
  return normalizeText(value)
    .replace(/[®™]/g, '')
    .replace(/[「」'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function productSearchQueries(product) {
  const queries = [
    normalizeText(product.reference),
    normalizeSearchTerm(product.name),
  ];
  return [...new Set(queries.filter(Boolean))].slice(0, 4);
}

function productSearchUrl(query) {
  const url = new URL('https://www.mariagefreres.com/fr/catalogsearch/result/');
  url.searchParams.set('q', query);
  return url.href;
}

function looksLikeProductUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'www.mariagefreres.com') return false;
    if (!parsed.pathname.startsWith('/fr/')) return false;
    if (!parsed.pathname.endsWith('.html')) return false;
    if (/checkout|customer|catalogsearch|wishlist|review|contacts/i.test(parsed.pathname)) return false;
    if (!/(^|-)t\d{2,5}([-.]|$)/i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

async function collectProductSearchCandidates(page) {
  return page.evaluate(() => {
    const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('a[href]')]
      .map((anchor) => ({
        href: anchor.href,
        text: text(anchor),
        closestText: text(anchor.closest('.product-item, li, article, .item, .product')),
      }))
      .filter((entry) => entry.href);
  });
}

async function discoverProductPageUrl(context, product, config, debug) {
  const page = await context.newPage();
  const queries = productSearchQueries(product);
  const seen = new Set();
  const attempted = [];
  const startedAt = nowIso();

  try {
    for (const query of queries) {
      const searchUrl = productSearchUrl(query);
      if (debug) console.log(`[url-search] ${product.reference} query=${query} ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 90000 });
      await page.waitForLoadState('networkidle', { timeout: config.networkIdleTimeoutMs || 45000 }).catch(() => {});
      await sleep(config.settleDelayMs || 2500);

      const title = await page.title().catch(() => '');
      const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      if (/cloudflare|verify you are human|vérifiez que vous êtes humain|just a moment/i.test(`${title}\n${bodyText}`)) {
        return {
          success: false,
          status: 'error',
          method: 'official_search',
          searched_queries: queries,
          attempted_urls: attempted,
          acquired_at: startedAt,
          error_message: 'Official search is blocked by browser verification.',
        };
      }
      if (/aucun résultat|aucun resultat|no results/i.test(bodyText)) {
        if (debug) console.log(`[url-search-empty] ${product.reference} query=${query}`);
        continue;
      }

      const candidates = await collectProductSearchCandidates(page);
      const urls = candidates
        .map((candidate) => candidate.href)
        .filter((url) => looksLikeProductUrl(url))
        .filter((url) => {
          if (seen.has(url)) return false;
          seen.add(url);
          return true;
        })
        .slice(0, 10);

      if (debug) {
        console.log(`[url-candidates] ${product.reference} query=${query} count=${urls.length}`);
        for (const url of urls) console.log(`[url-candidate] ${product.reference} ${url}`);
      }

      for (const url of urls) {
        attempted.push(url);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 90000 });
        await page.waitForLoadState('networkidle', { timeout: config.networkIdleTimeoutMs || 45000 }).catch(() => {});
        await sleep(config.settleDelayMs || 2500);

        const finalUrl = page.url();
        const titleText = await page.title().catch(() => '');
        const visibleText = await page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
        if (/cloudflare|verify you are human|vérifiez que vous êtes humain|just a moment/i.test(`${titleText}\n${visibleText}`)) {
          return {
            success: false,
            status: 'error',
            method: 'official_search',
            searched_queries: queries,
            attempted_urls: attempted,
            acquired_at: startedAt,
            error_message: 'Candidate product page is blocked by browser verification.',
          };
        }
        if (referenceRegex(product.reference).test(visibleText)) {
          if (debug) console.log(`[url-verified] ${product.reference} ${finalUrl}`);
          return {
            success: true,
            status: 'available',
            method: 'official_search',
            url: finalUrl,
            source_url: searchUrl,
            searched_queries: queries,
            attempted_urls: attempted,
            acquired_at: startedAt,
            error_message: '',
          };
        }
        if (debug) console.log(`[url-rejected] ${product.reference} ${finalUrl}`);
      }
    }

    return {
      success: false,
      status: 'not_found',
      method: 'official_search',
      searched_queries: queries,
      attempted_urls: attempted,
      acquired_at: startedAt,
      error_message: 'No official product page with exact reference was verified.',
    };
  } catch (error) {
    return {
      success: false,
      status: 'error',
      method: 'official_search',
      searched_queries: queries,
      attempted_urls: attempted,
      acquired_at: startedAt,
      error_message: error.message,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function createCdpNetworkCapture(page, debug) {
  const session = await page.context().newCDPSession(page);
  const responses = new Map();
  const bodies = new Map();

  await session.send('Network.enable');

  session.on('Network.responseReceived', (event) => {
    const headers = event.response.headers || {};
    const mime = String(event.response.mimeType || headers['content-type'] || headers['Content-Type'] || '').split(';')[0].toLowerCase();
    const isImage = event.type === 'Image' || mime.startsWith('image/') || isProbablyImageUrl(event.response.url);
    if (!isImage) return;
    responses.set(event.requestId, {
      requestId: event.requestId,
      url: event.response.url,
      status: event.response.status,
      mimeType: mime,
      headers,
      width: 0,
      height: 0,
      sourceKind: 'network',
    });
    if (debug) console.log(`[network] ${event.response.status} ${mime} ${event.response.url}`);
  });

  session.on('Network.loadingFinished', async (event) => {
    const response = responses.get(event.requestId);
    if (!response) return;
    try {
      const body = await session.send('Network.getResponseBody', { requestId: event.requestId });
      const buffer = body.base64Encoded ? Buffer.from(body.body, 'base64') : Buffer.from(body.body, 'utf8');
      bodies.set(response.url, { ...response, buffer, encodedDataLength: event.encodedDataLength });
    } catch (error) {
      bodies.set(response.url, { ...response, error: error.message, encodedDataLength: event.encodedDataLength });
    }
  });

  return { session, responses, bodies };
}

async function collectDomCandidates(page, pageUrl) {
  const raw = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const trim = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    const add = (entry) => {
      if (!entry.url) return;
      const key = `${entry.sourceKind}:${entry.url}:${entry.alt || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(entry);
    };
    const contextText = (el) => {
      let node = el;
      for (let i = 0; node && i < 7; i += 1, node = node.parentElement) {
        const text = trim(node.innerText || node.textContent);
        if (/liqueur|liquor|liquore|description|infusion|réf|ref/i.test(text)) return text;
      }
      return '';
    };

    for (const img of document.querySelectorAll('img')) {
      const rect = img.getBoundingClientRect();
      add({
        sourceKind: 'currentSrc',
        url: img.currentSrc || img.src,
        sourceUrl: img.src,
        srcset: img.getAttribute('srcset') || '',
        alt: img.getAttribute('alt') || '',
        title: img.getAttribute('title') || '',
        id: img.id || '',
        className: String(img.className || ''),
        width: Math.round(rect.width || img.naturalWidth || 0),
        height: Math.round(rect.height || img.naturalHeight || 0),
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        closestText: trim(img.closest('figure, li, section, article, div')?.innerText),
        sectionText: contextText(img),
        selectorHint: img.alt ? `img[alt="${img.alt.replace(/"/g, '\\"')}"]` : '',
      });
      for (const attr of img.getAttributeNames()) {
        if (!/^(data-|src|srcset)$/i.test(attr)) continue;
        const value = img.getAttribute(attr) || '';
        for (const match of value.matchAll(/https?:\/\/[^"',)\s]+|\/[^"',)\s]+\.(?:jpg|jpeg|png|webp|avif|gif)[^"',)\s]*/gi)) {
          add({
            sourceKind: `dom.${attr}`,
            url: match[0],
            alt: img.getAttribute('alt') || '',
            width: Math.round(rect.width || 0),
            height: Math.round(rect.height || 0),
            closestText: trim(img.closest('figure, li, section, article, div')?.innerText),
            sectionText: contextText(img),
          });
        }
      }
    }

    for (const source of document.querySelectorAll('picture source, source[srcset]')) {
      const srcset = source.getAttribute('srcset') || '';
      const rect = source.parentElement?.getBoundingClientRect?.() || {};
      for (const item of srcset.split(',')) {
        const url = item.trim().split(/\s+/)[0];
        add({
          sourceKind: 'picture.source',
          url,
          srcset,
          width: Math.round(rect.width || 0),
          height: Math.round(rect.height || 0),
          closestText: trim(source.closest('figure, li, section, article, div')?.innerText),
          sectionText: contextText(source),
        });
      }
    }

    for (const el of document.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') continue;
      for (const match of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const rect = el.getBoundingClientRect();
        add({
          sourceKind: 'css.backgroundImage',
          url: match[1],
          id: el.id || '',
          className: String(el.className || ''),
          width: Math.round(rect.width || 0),
          height: Math.round(rect.height || 0),
          closestText: trim(el.closest('figure, li, section, article, div')?.innerText),
          sectionText: contextText(el),
        });
      }
    }

    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent || '';
      for (const match of text.matchAll(/https?:\/\/[^"',)\s]+\.(?:jpg|jpeg|png|webp|avif|gif)[^"',)\s]*|\/[^"',)\s]+\.(?:jpg|jpeg|png|webp|avif|gif)[^"',)\s]*/gi)) {
        add({
          sourceKind: 'embedded_json',
          url: match[0],
          closestText: trim(text.slice(Math.max(0, match.index - 140), match.index + 240)),
        });
      }
    }

    return out;
  });

  return raw.map((candidate) => ({ ...candidate, url: normalizeUrl(candidate.url, pageUrl) })).filter((candidate) => candidate.url);
}

async function collectCacheApiCandidates(page) {
  return page.evaluate(async () => {
    if (!('caches' in window)) return [];
    const out = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const mime = (response?.headers?.get('content-type') || '').split(';')[0].toLowerCase();
        if (mime.startsWith('image/') || /\.(avif|webp|png|jpe?g|gif)(?:[?#]|$)/i.test(request.url)) {
          out.push({ sourceKind: 'cache', url: request.url, mimeType: mime });
        }
      }
    }
    return out;
  }).catch(() => []);
}

async function browserFetchImage(page, candidate) {
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
    return { bytes, mimeType, resolvedUrl: response.url };
  }, candidate.url);
  return {
    buffer: Buffer.from(result.bytes),
    mimeType: result.mimeType,
    resolvedUrl: result.resolvedUrl,
  };
}

async function screenshotCandidateElement(page, candidate) {
  if (!candidate.selectorHint) return null;
  const locator = page.locator(candidate.selectorHint).first();
  if ((await locator.count()) === 0) return null;
  const buffer = await locator.screenshot({ type: 'png' });
  return { buffer, mimeType: 'image/png', resolvedUrl: candidate.url };
}

async function saveImage({ baseDir, imageType, product, pageUrl, candidate, acquired, method, logFile }) {
  const mimeType = acquired.mimeType || candidate.mimeType || '';
  const ext = extensionForMime(mimeType, candidate.url);
  const typeDir = IMAGE_TYPE_FOLDERS[imageType] || imageType;
  const liqueurName = basenameFromUrl(acquired.resolvedUrl || candidate.url);
  const fileName = imageType === 'liqueur' && liqueurName
    ? liqueurName
    : `${sanitizeReference(product.reference)}${ext}`;
  const filePath = path.join(baseDir, typeDir, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, acquired.buffer);

  const row = {
    reference: product.reference,
    image_type: imageType,
    source_page_url: pageUrl,
    source_url: candidate.sourceUrl || candidate.url,
    resolved_url: acquired.resolvedUrl || candidate.url,
    width: candidate.naturalWidth || candidate.width || 0,
    height: candidate.naturalHeight || candidate.height || 0,
    mime_type: mimeType,
    acquired_method: method,
    acquired_at: nowIso(),
    success: true,
    error_message: '',
    file_path: filePath,
  };
  appendJsonl(logFile, row);
  return row;
}

async function acquireImage({ page, networkBodies, candidate, imageType, product, pageUrl, imagesDir, logFile, debug }) {
  const sameNetwork = networkBodies.get(candidate.url);
  if (sameNetwork?.buffer?.length) {
    return saveImage({
      baseDir: imagesDir,
      imageType,
      product,
      pageUrl,
      candidate,
      acquired: { buffer: sameNetwork.buffer, mimeType: sameNetwork.mimeType, resolvedUrl: sameNetwork.url },
      method: 'network',
      logFile,
    });
  }

  const networkByPath = [...networkBodies.values()].find((entry) => {
    try {
      const a = new URL(entry.url);
      const b = new URL(candidate.url);
      return a.pathname === b.pathname && entry.buffer?.length;
    } catch {
      return false;
    }
  });
  if (networkByPath?.buffer?.length) {
    return saveImage({
      baseDir: imagesDir,
      imageType,
      product,
      pageUrl,
      candidate,
      acquired: { buffer: networkByPath.buffer, mimeType: networkByPath.mimeType, resolvedUrl: networkByPath.url },
      method: 'network',
      logFile,
    });
  }

  try {
    const acquired = await browserFetchImage(page, candidate);
    return saveImage({
      baseDir: imagesDir,
      imageType,
      product,
      pageUrl,
      candidate,
      acquired,
      method: candidate.sourceKind === 'embedded_json' ? 'embedded_json' : candidate.sourceKind === 'cache' ? 'cache' : 'currentSrc',
      logFile,
    });
  } catch (error) {
    if (debug) console.log(`[fallback-fetch-failed] ${imageType} ${candidate.url} ${error.message}`);
  }

  try {
    const acquired = await screenshotCandidateElement(page, candidate);
    if (acquired?.buffer?.length) {
      return saveImage({
        baseDir: imagesDir,
        imageType,
        product,
        pageUrl,
        candidate,
        acquired,
        method: 'screenshot',
        logFile,
      });
    }
  } catch (error) {
    if (debug) console.log(`[screenshot-failed] ${imageType} ${candidate.url} ${error.message}`);
  }

  const row = {
    reference: product.reference,
    image_type: imageType,
    source_page_url: pageUrl,
    source_url: candidate.sourceUrl || candidate.url,
    resolved_url: candidate.url,
    width: candidate.naturalWidth || candidate.width || 0,
    height: candidate.naturalHeight || candidate.height || 0,
    mime_type: candidate.mimeType || '',
    acquired_method: '',
    acquired_at: nowIso(),
    success: false,
    error_message: 'No acquisition method succeeded for selected candidate.',
  };
  appendJsonl(logFile, row);
  return row;
}

async function processProduct({
  context,
  product,
  config,
  paths,
  debug,
  useExistingPages = false,
  reloadExistingPages = true,
  keepPagesOpen = false,
}) {
  const pageInfo = await getProductPage(context, product, { useExistingPages });
  const page = pageInfo.page;
  const pageUrl = product.productUrl;
  const cdp = await createCdpNetworkCapture(page, debug);
  const startedAt = Date.now();
  const result = { reference: product.reference, pageUrl, images: {}, successCount: 0 };

  try {
    if (debug) console.log(`[open] ${product.reference} ${pageUrl}`);
    if (pageInfo.reused) {
      if (debug) console.log(`[reuse-page] ${product.reference} ${page.url()}`);
      await page.bringToFront().catch(() => {});
      if (reloadExistingPages) {
        if (debug) console.log(`[reload-existing-page] ${product.reference}`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 90000 });
      }
      await page.waitForLoadState('networkidle', { timeout: config.networkIdleTimeoutMs || 45000 }).catch(() => {});
    } else {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 90000 });
      await page.waitForLoadState('networkidle', { timeout: config.networkIdleTimeoutMs || 45000 }).catch(() => {});
    }
    await sleep(config.settleDelayMs || 2500);

    const title = await page.title();
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const blocked = /cloudflare|verify you are human|vérifiez que vous êtes humain|just a moment/i.test(`${title}\n${bodyText}`);
    if (blocked) {
      throw new Error('Page appears to be blocked by browser verification. Run with --headed and complete the verification in the persistent profile.');
    }

    const domCandidates = await collectDomCandidates(page, pageUrl);
    const cacheCandidates = await collectCacheApiCandidates(page);
    const networkCandidates = [...cdp.bodies.values()].map((entry) => ({
      sourceKind: 'network',
      url: entry.url,
      mimeType: entry.mimeType,
      width: 0,
      height: 0,
    }));
    const allCandidates = [...domCandidates, ...cacheCandidates, ...networkCandidates];

    if (debug) {
      console.log(`[candidates] ${product.reference} ${allCandidates.length}`);
      for (const candidate of allCandidates) {
        const tea = classifyCandidate(candidate, product, 'tea');
        const liqueur = classifyCandidate(candidate, product, 'liqueur');
        console.log(JSON.stringify({
          type: candidate.sourceKind,
          url: candidate.url,
          alt: candidate.alt || '',
          width: candidate.naturalWidth || candidate.width || 0,
          height: candidate.naturalHeight || candidate.height || 0,
          mime: candidate.mimeType || '',
          tea,
          liqueur,
        }));
      }
    }

    if (debug) {
      fs.writeFileSync(
        path.join(paths.logsDir, `${product.reference}-candidates-${startedAt}.json`),
        JSON.stringify({ product, title, domCandidates, cacheCandidates, networkCandidates }, null, 2)
      );
    }

    for (const imageType of IMAGE_TYPES) {
      const candidate = pickCandidate(allCandidates, product, imageType);
      if (!candidate) {
        const row = {
          reference: product.reference,
          image_type: imageType,
          source_page_url: pageUrl,
          source_url: '',
          resolved_url: '',
          width: 0,
          height: 0,
          mime_type: '',
          acquired_method: '',
          acquired_at: nowIso(),
          success: false,
          not_available: true,
          status: 'not_available',
          error_message: `No ${imageType} candidate detected.`,
        };
        appendJsonl(paths.resultLog, row);
        result.images[imageType] = row;
        continue;
      }
      if (debug) console.log(`[selected] ${product.reference} ${imageType} ${candidate.sourceKind} ${candidate.url}`);
      const row = await acquireImage({
        page,
        networkBodies: cdp.bodies,
        candidate,
        imageType,
        product,
        pageUrl,
        imagesDir: paths.imagesDir,
        logFile: paths.resultLog,
        debug,
      });
      result.images[imageType] = row;
      if (row.success) result.successCount += 1;
    }

    return result;
  } catch (error) {
    for (const imageType of IMAGE_TYPES) {
      appendJsonl(paths.resultLog, {
        reference: product.reference,
        image_type: imageType,
        source_page_url: pageUrl,
        source_url: '',
        resolved_url: '',
        width: 0,
        height: 0,
        mime_type: '',
        acquired_method: '',
        acquired_at: nowIso(),
        success: false,
        error_message: error.message,
      });
    }
    result.error = error.message;
    return result;
  } finally {
    await cdp.session.detach().catch(() => {});
    if (pageInfo.shouldClose && !keepPagesOpen) await page.close().catch(() => {});
  }
}

function productImageStatus(product) {
  const teaComplete = hasValue(product.master?.teaImageUrl) || product.master?.teaImageStatus === 'not_available';
  const teaThumbnailComplete = hasValue(product.master?.teaThumbnailUrl) || product.master?.teaThumbnailStatus === 'not_available';
  const liqueurComplete = hasValue(product.master?.liqueurImageUrl) || product.master?.liqueurImageStatus === 'not_available';
  if (teaComplete && teaThumbnailComplete && liqueurComplete) return 'complete';
  if (teaComplete || teaThumbnailComplete || liqueurComplete) return 'partial';
  return 'pending';
}

function selectProducts(config, state, refs, sourceProducts = null) {
  const maxRetries = Number.isFinite(config.maxRetries) ? config.maxRetries : 3;
  const hasMasterProducts = Boolean(sourceProducts?.length);
  const productList = hasMasterProducts ? sourceProducts : config.products || [];
  const merged = productList.map((product) => {
    const localState = state.products?.[product.reference] || {};
    const masterStatus = productImageStatus(product);
    return {
      ...product,
      master_status: masterStatus,
      ...localState,
      productUrl: product.productUrl || localState.productUrl,
    };
  });
  const filtered = refs?.length
    ? merged.filter((product) => refs.includes(product.reference))
    : merged.filter((product) => {
        const localStatus = product.status || '';
        const masterStatus = product.master_status || 'pending';
        const urlDiscoveryStatus = normalizeProductUrlStatus(product.urlDiscovery?.status) || product.master?.productUrlStatus || '';
        const status = hasMasterProducts && masterStatus !== 'complete' && localStatus === 'complete'
          ? masterStatus
          : localStatus || masterStatus;
        const retryCount = product.retry_count || 0;
        if (!hasValue(product.productUrl) && urlDiscoveryStatus === 'not_found') return false;
        if (status === 'complete') return false;
        if (status === 'error' && retryCount >= maxRetries) return false;
        return ['pending', 'partial', 'retry', 'error'].includes(status) || product.master_status === 'partial';
      });
  return filtered.slice(0, refs?.length ? refs.length : config.maxPerRun || 5);
}

function writeBackRequired(config) {
  return config.writeBack?.enabled === true;
}

function resultIsComplete(result, config) {
  const resolvedCount = IMAGE_TYPES.filter((type) => {
    const row = result.images?.[type];
    return row?.success || row?.not_available;
  }).length;
  return resolvedCount === IMAGE_TYPES.length && (!writeBackRequired(config) || result.writeBack?.success === true);
}

function updateState(state, product, result, maxRetries, config = {}) {
  state.products = state.products || {};
  const previous = state.products[product.reference] || {};
  const complete = resultIsComplete(result, config);
  const retryCount = complete ? previous.retry_count || 0 : (previous.retry_count || product.retry_count || 0) + 1;
  let status = 'error';
  if (complete) status = 'complete';
  else if (result.successCount > 0) status = 'partial';
  else if (retryCount < maxRetries) status = 'retry';

  state.products[product.reference] = {
    status,
    retry_count: retryCount,
    updated_at: nowIso(),
    last_error: result.error || '',
    productUrl: product.productUrl || previous.productUrl || '',
    urlDiscovery: result.urlDiscovery || previous.urlDiscovery || null,
    images: result.images,
    writeBack: result.writeBack || null,
  };
}

function compactImageResult(row) {
  if (!row) return 'missing';
  if (row.not_available || row.status === 'not_available') return 'not_available';
  if (!row.success) return `fail${row.error_message ? ` (${row.error_message})` : ''}`;
  return `ok:${row.acquired_method || 'unknown'}`;
}

function logProductSummary(product, stateEntry) {
  const tea = stateEntry.images?.tea;
  const teaThumbnail = stateEntry.images?.teaThumbnail;
  const liqueur = stateEntry.images?.liqueur;
  const methods = IMAGE_TYPES
    .map((type) => stateEntry.images?.[type]?.success ? `${type}:${stateEntry.images[type].acquired_method}` : '')
    .filter(Boolean)
    .join(',');
  const errors = IMAGE_TYPES
    .map((type) => {
      const row = stateEntry.images?.[type];
      return row && !row.success && row.error_message ? `${type}:${row.error_message}` : '';
    })
    .filter(Boolean)
    .join(' | ');
  const error = errors || stateEntry.last_error || stateEntry.writeBack?.error_message || '';

  console.log(JSON.stringify({
    reference: product.reference,
    product_url: product.productUrl || '',
    urlDiscovery: stateEntry.urlDiscovery?.status || '',
    tea: compactImageResult(tea),
    teaThumbnail: compactImageResult(teaThumbnail),
    liqueur: compactImageResult(liqueur),
    status: stateEntry.status,
    acquired_method: methods,
    drive: stateEntry.writeBack?.success ? 'ok' : '',
    error,
  }));
}

function logUrlDiscoverySummary(product, result) {
  console.log(JSON.stringify({
    reference: product.reference,
    product_url: result.urlDiscovery?.url || '',
    urlDiscovery: result.urlDiscovery?.status || 'error',
    status: result.status || 'retry',
    error: result.error || result.urlDiscovery?.error_message || '',
  }));
}

async function waitForEnter(message) {
  console.log(message);
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

async function runAuthSetup({ context, products, config, debug, keepPageOpen = false }) {
  const page = context.pages()[0] || await context.newPage();
  const firstUrl = products[0]?.productUrl || 'https://www.mariagefreres.com/fr/';
  await page.bringToFront().catch(() => {});
  await page.evaluate(() => {
    window.moveTo(80, 80);
    window.resizeTo(1400, 1000);
  }).catch(() => {});
  console.log(`Opening ${firstUrl}`);
  await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 90000 }).catch((error) => {
    console.log(`Initial navigation warning: ${error.message}`);
  });
  await page.bringToFront().catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: config.networkIdleTimeoutMs || 45000 }).catch(() => {});
  console.log('');
  console.log('Complete any Cloudflare/browser verification in the opened Chrome window.');
  console.log('Use only this collector profile window; your normal Chrome profile is not used.');
  console.log('After the product page is visible, press Enter here to save and reuse the profile.');
  await waitForEnter('');

  const title = await page.title().catch(() => '');
  const url = page.url();
  const cookies = await context.cookies().catch(() => []);
  if (debug) {
    console.log(`[auth-setup] title=${title}`);
    console.log(`[auth-setup] url=${url}`);
    console.log(`[auth-setup] cookies=${cookies.length}`);
  }
  if (!keepPageOpen) await page.close().catch(() => {});
}

async function connectBrowser(args) {
  const browser = await chromium.connectOverCDP(args.connectCdp);
  const context = browser.contexts()[0] || await browser.newContext();
  return { browser, context };
}

async function main() {
  const args = parseArgs(process.argv);
  const baseDir = process.cwd();
  const configPath = resolveProjectPath(baseDir, args.config);
  const fallbackConfigPath = path.join(baseDir, 'collector', 'config.example.json');
  const config = readJson(configPath, readJson(fallbackConfigPath));
  if (!config) throw new Error(`Config not found: ${configPath}`);
  if (args.writeBack !== null) {
    config.writeBack = { ...(config.writeBack || {}), enabled: args.writeBack };
  }

  const paths = {
    profileDir: resolveProjectPath(baseDir, config.profileDir || 'browser-profile'),
    imagesDir: resolveProjectPath(baseDir, config.imagesDir || 'images'),
    logsDir: resolveProjectPath(baseDir, config.logsDir || 'logs'),
    stateFile: resolveProjectPath(baseDir, config.stateFile || 'collector-state.json'),
  };
  paths.resultLog = path.join(paths.logsDir, `results-${new Date().toISOString().slice(0, 10)}.jsonl`);

  fs.mkdirSync(paths.profileDir, { recursive: true });
  fs.mkdirSync(paths.imagesDir, { recursive: true });
  fs.mkdirSync(paths.logsDir, { recursive: true });

  const headless = args.authSetup ? false : args.headless === true ? true : args.headed ? false : config.headless !== false;
  const state = readJson(paths.stateFile, { products: {} });
  const useConfigProducts = args.useConfigProducts || config.masterSource?.enabled === false;
  const master = useConfigProducts ? null : await fetchMasterProducts(config, baseDir, args.debug);
  if (!master && !useConfigProducts) {
    throw new Error('Master products are required for normal collector runs. Use --use-config-products only for explicit local tests.');
  }
  const products = selectProducts(config, state, args.refs, master?.products || null);

  if (products.length === 0) {
    console.log('No pending products selected.');
    return;
  }

  console.log(`Selected ${products.length} product(s)${master ? ` from master rows=${master.rowCount}` : ' from config'}.`);

  if (args.dryRun) {
    for (const product of products) {
      console.log(JSON.stringify({
        reference: product.reference,
        name: product.name || '',
        product_url: product.productUrl,
        master_status: product.master_status || 'pending',
        state_status: state.products?.[product.reference]?.status || '',
      }));
    }
    return;
  }

  const launchOptions = {
    headless,
    viewport: args.authSetup ? null : { width: 1440, height: 1200 },
    locale: 'fr-FR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151 Safari/537.36',
    args: [
      '--new-window',
      '--start-maximized',
      '--window-position=80,80',
      '--window-size=1400,1000',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  };

  let browserChannel = '';
  if (process.env.MF_COLLECTOR_CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.MF_COLLECTOR_CHROMIUM_PATH;
  } else {
    browserChannel = args.browserChannel || config.browserChannel || process.env.MF_COLLECTOR_BROWSER_CHANNEL || '';
    if (browserChannel) launchOptions.channel = browserChannel;
  }

  if (args.debug || args.authSetup) {
    console.log(`[mode] ${args.connectCdp ? 'connect-cdp' : 'launch'}`);
    if (args.connectCdp) console.log(`[cdp] endpoint=${args.connectCdp}`);
    console.log(`[launch] headless=${args.connectCdp ? '(external browser)' : launchOptions.headless}`);
    console.log(`[launch] channel=${args.connectCdp ? '(external browser)' : launchOptions.channel || ''}`);
    console.log(`[launch] executablePath=${args.connectCdp ? '(external browser)' : launchOptions.executablePath || ''}`);
    console.log(`[launch] profileDir=${paths.profileDir}`);
  }

  const externalBrowser = args.connectCdp ? await connectBrowser(args) : null;
  const context = externalBrowser
    ? externalBrowser.context
    : await chromium.launchPersistentContext(paths.profileDir, launchOptions);

  try {
    if (externalBrowser && args.authSetup) {
      console.log('Connected to existing Chrome. Complete verification there, then press Enter here.');
      await runAuthSetup({ context, products, config, debug: args.debug, keepPageOpen: true });
      return;
    }

    if (args.authSetup) {
      await runAuthSetup({ context, products, config, debug: args.debug });
      return;
    }

    for (let i = 0; i < products.length; i += 1) {
      const product = products[i];
      const masterHasProductUrl = hasValue(product.master?.productUrl);
      if (args.discoverUrlsOnly && masterHasProductUrl) {
        const existingResult = {
          urlDiscovery: {
            success: true,
            status: 'available',
            method: 'master',
            url: product.master.productUrl,
            error_message: '',
          },
          status: product.status || product.master_status || 'pending',
        };
        logUrlDiscoverySummary(product, existingResult);
        if (i < products.length - 1) {
          const waitMs = randomDelay(config.pageDelayMs);
          if (args.debug) console.log(`[delay] ${waitMs}ms`);
          await sleep(waitMs);
        }
        continue;
      }

      if (!masterHasProductUrl) {
        const discovery = hasValue(product.productUrl) && product.urlDiscovery?.status === 'available'
          ? {
              success: true,
              status: 'available',
              method: 'local_state',
              url: product.productUrl,
              source_url: '',
              searched_queries: [],
              attempted_urls: [],
              acquired_at: nowIso(),
              error_message: '',
            }
          : await discoverProductPageUrl(context, product, config, args.debug);
        const previous = state.products?.[product.reference] || {};
        const maxRetries = Number.isFinite(config.maxRetries) ? config.maxRetries : 3;
        const discoveryRetryCount = discovery.success ? previous.retry_count || 0 : (previous.retry_count || product.retry_count || 0) + 1;
        const normalizedDiscoveryStatus = normalizeProductUrlStatus(discovery.status);
        const discoveryStatusForState = discovery.success
          ? 'available'
          : normalizedDiscoveryStatus === 'not_found' && discoveryRetryCount >= maxRetries
            ? 'not_found'
            : 'error';
        const discoveryForState = {
          ...discovery,
          status: discoveryStatusForState,
          retry_count: discoveryRetryCount,
        };
        const discoveryResult = {
          reference: product.reference,
          pageUrl: '',
          images: {},
          successCount: 0,
          urlDiscovery: discoveryForState,
          error: discovery.success ? '' : discovery.error_message,
        };

        if (discovery.success) {
          product.productUrl = discovery.url;
        }

        try {
          await writeBackProductPageUrl({ config, baseDir, product, discovery: discoveryForState, debug: args.debug });
        } catch (error) {
          discoveryResult.error = discoveryResult.error
            ? `${discoveryResult.error} | url writeback: ${error.message}`
            : `url writeback: ${error.message}`;
          discoveryResult.urlDiscovery = {
            ...discoveryForState,
            writeBack: { success: false, error_message: error.message, updated_at: nowIso() },
          };
          if (args.debug) console.log(`[url-writeback-failed] ${product.reference} ${error.message}`);
        }

        state.products = state.products || {};
        if (args.discoverUrlsOnly || !discovery.success || (writeBackRequired(config) && discoveryResult.urlDiscovery?.writeBack?.success === false)) {
          const status = discovery.success ? previous.status || 'pending' : discoveryRetryCount < maxRetries ? 'retry' : 'error';
          state.products[product.reference] = {
            ...previous,
            status,
            retry_count: discoveryRetryCount,
            updated_at: nowIso(),
            last_error: discoveryResult.error || '',
            productUrl: product.productUrl || previous.productUrl || '',
            urlDiscovery: discoveryResult.urlDiscovery,
            images: previous.images || {},
            writeBack: previous.writeBack || null,
          };
          writeJson(paths.stateFile, state);
          logUrlDiscoverySummary(product, { ...discoveryResult, status });
          if (i < products.length - 1) {
            const waitMs = randomDelay(config.pageDelayMs);
            if (args.debug) console.log(`[delay] ${waitMs}ms`);
            await sleep(waitMs);
          }
          continue;
        }
      }

      const result = await processProduct({
        context,
        product,
        config,
        paths,
        debug: args.debug,
        useExistingPages: args.useExistingPages || Boolean(args.connectCdp),
        reloadExistingPages: args.reloadExistingPages,
        keepPagesOpen: Boolean(args.connectCdp),
      });
      try {
        await writeBackImageResults({ config, baseDir, product, result, debug: args.debug });
      } catch (error) {
        result.writeBack = { success: false, error_message: error.message, updated_at: nowIso() };
        result.error = result.error ? `${result.error} | writeback: ${error.message}` : `writeback: ${error.message}`;
        if (args.debug) console.log(`[writeback-failed] ${product.reference} ${error.message}`);
      }
      updateState(state, product, result, Number.isFinite(config.maxRetries) ? config.maxRetries : 3, config);
      writeJson(paths.stateFile, state);
      logProductSummary(product, state.products[product.reference]);

      if (i < products.length - 1) {
        const waitMs = randomDelay(config.pageDelayMs);
        if (args.debug) console.log(`[delay] ${waitMs}ms`);
        await sleep(waitMs);
      }
    }
  } finally {
    if (!externalBrowser) await context.close();
    else setImmediate(() => process.exit(process.exitCode || 0));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
