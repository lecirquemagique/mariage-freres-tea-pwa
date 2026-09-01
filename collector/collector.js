#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const DEFAULT_CONFIG = 'config.json';
const IMAGE_TYPES = ['tea', 'teaThumbnail', 'liqueur'];
const IMAGE_TYPE_FOLDERS = {
  tea: 'tea',
  teaThumbnail: 'tea-thumbnail',
  liqueur: 'liqueur',
};
const DRIVE_THUMBNAIL_SIZE = 'w1200';
const PRODUCT_URL_DISCOVERY_VERSION = 'official-search-fr-en-jp-v1';
const PRODUCT_URL_NOT_FOUND_MESSAGE = 'No official product page with exact reference was verified.';
const MASTER_COLUMNS = {
  reference: 'Tリファレンス番号',
  name: '現在の公式名',
  fallbackName: '銘柄名（黒い本）',
  officialDescription: '現在の公式説明',
  officialDescriptionSourceLanguage: '現在の公式説明根拠言語',
  officialDescriptionSourceUrl: '現在の公式説明根拠URL',
  officialDescriptionOriginal: '現在の公式説明原文',
  officialCategory: '現在のカテゴリ',
  teaImageUrl: '茶葉画像URL',
  teaThumbnailUrl: '茶葉サムネイルURL',
  liqueurImageUrl: '水色画像URL',
  teaImageStatus: '茶葉画像状態',
  teaThumbnailStatus: '茶葉サムネイル状態',
  liqueurImageStatus: '水色画像状態',
  productUrl: '公式商品ページURL',
  productUrlStatus: '公式商品ページURL状態',
  versionKey: 'VersionKey',
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
    discoverNewReferences: false,
    backfillOfficialDescriptions: false,
    statusJson: false,
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
    else if (arg === '--discover-new-references') args.discoverNewReferences = true;
    else if (arg === '--backfill-official-descriptions') args.backfillOfficialDescriptions = true;
    else if (arg === '--status-json') args.statusJson = true;
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

function parseTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
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

function isDiscoveryNotFoundResult(discovery) {
  const status = normalizeProductUrlStatus(discovery?.status);
  if (status === 'not_found') return true;
  return status === 'error' &&
    normalizeText(discovery?.error_message) === PRODUCT_URL_NOT_FOUND_MESSAGE;
}

function isCurrentDiscoveryNotFoundResult(discovery) {
  return isDiscoveryNotFoundResult(discovery) &&
    normalizeText(discovery?.discovery_version) === PRODUCT_URL_DISCOVERY_VERSION;
}

function hasLegacyDiscoveryNotFoundResult(discovery) {
  return isDiscoveryNotFoundResult(discovery) && !isCurrentDiscoveryNotFoundResult(discovery);
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
    headers: { 'content-type': 'application/json; charset=utf-8' },
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
    headers: { 'content-type': 'application/json; charset=utf-8' },
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

async function writeBackReviewCandidate({ config, baseDir, candidate, debug }) {
  const settings = getWriteBackSettings(config, baseDir);
  if (!settings) return null;

  const payload = {
    action: 'recordReviewCandidate',
    secret: settings.secret,
    candidate,
  };
  if (debug) {
    console.log(`[review-writeback] ${candidate.reference} ${candidate.detection_type} ${candidate.detection_id || ''}`);
  }

  const response = await fetch(settings.gasApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(formatWriteBackResponseError('Review candidate writeback did not return JSON', settings, response, text));
  }
  if (!response.ok || data.ok === false) {
    throw new Error(formatWriteBackResponseError(`Review candidate writeback failed: ${data.error || responsePreview(text)}`, settings, response, text));
  }
  return data;
}

async function writeBackMasterOfficialInfo({ config, baseDir, product, officialInfo, debug }) {
  const settings = getWriteBackSettings(config, baseDir);
  if (!settings) return null;

  const payload = {
    action: 'updateMasterOfficialInfo',
    secret: settings.secret,
    reference: product.reference,
    version_key: product.master?.versionKey || '',
    product_page_url: product.productUrl,
    official_description: officialInfo.description || '',
    official_description_original: officialInfo.originalDescription || '',
    official_description_source_language: officialInfo.language || '',
    official_description_source_url: officialInfo.sourceUrl || product.productUrl || '',
    official_category: officialInfo.category || '',
    source_language: officialInfo.language || '',
    source_url: officialInfo.sourceUrl || product.productUrl || '',
  };
  if (debug) {
    console.log(`[official-info-writeback] ${product.reference} description=${payload.official_description ? 'yes' : 'no'} category=${payload.official_category || ''}`);
  }

  const response = await fetch(settings.gasApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(formatWriteBackResponseError('Official info writeback did not return JSON', settings, response, text));
  }
  if (!response.ok || data.ok === false) {
    throw new Error(formatWriteBackResponseError(`Official info writeback failed: ${data.error || responsePreview(text)}`, settings, response, text));
  }
  return data;
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
          officialDescription: normalizeText(row[MASTER_COLUMNS.officialDescription]),
          officialDescriptionSourceLanguage: normalizeText(row[MASTER_COLUMNS.officialDescriptionSourceLanguage]),
          officialDescriptionSourceUrl: normalizeText(row[MASTER_COLUMNS.officialDescriptionSourceUrl]),
          officialDescriptionOriginal: normalizeText(row[MASTER_COLUMNS.officialDescriptionOriginal]),
          officialCategory: normalizeText(row[MASTER_COLUMNS.officialCategory]),
          productUrlStatus: normalizeProductUrlStatus(row[MASTER_COLUMNS.productUrlStatus]),
          teaImageUrl: normalizeText(row[MASTER_COLUMNS.teaImageUrl]),
          teaThumbnailUrl: normalizeText(row[MASTER_COLUMNS.teaThumbnailUrl]),
          liqueurImageUrl: normalizeText(row[MASTER_COLUMNS.liqueurImageUrl]),
          teaImageStatus: normalizeImageStatus(row[MASTER_COLUMNS.teaImageStatus]),
          teaThumbnailStatus: normalizeImageStatus(row[MASTER_COLUMNS.teaThumbnailStatus]),
          liqueurImageStatus: normalizeImageStatus(row[MASTER_COLUMNS.liqueurImageStatus]),
          versionKey: normalizeText(row[MASTER_COLUMNS.versionKey]),
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

function candidateContextText(candidate) {
  return [
    candidate.alt,
    candidate.title,
    candidate.id,
    candidate.className,
    candidate.closestText,
    candidate.sectionText,
  ].join(' ').toLowerCase();
}

function isProductContextLiqueurCandidate(candidate) {
  if (!isColorLiqueurCandidate(candidate)) return false;
  return /liqueur|liquor|liquore|couleur de la liqueur|color of the liqueur|水色/.test(candidateContextText(candidate));
}

function isCatalogProductCandidate(candidate) {
  return /media\/catalog\/product/i.test(candidate.url || '') ||
    /media\/catalog\/product/i.test(candidateHaystack(candidate));
}

function imageInfoFromOfficialUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)mariagefreres\.(com|co\.jp)$/i.test(url.hostname)) return null;
    const pathname = decodeURIComponent(url.pathname).toLowerCase();
    if (/\/media\/contentmanager\/content\/.*color_liqueur\//i.test(pathname)) {
      return { imageType: 'liqueur', reference: '', cacheKeyName: path.basename(pathname) };
    }
    if (!/\/media\/catalog\/product\//i.test(pathname)) return null;
    const file = path.basename(pathname);
    const match = file.match(/^(t\d{2,5})(-\d+p)?\.(jpe?g|png|webp|avif)$/i);
    if (!match) return null;
    return {
      reference: match[1].toUpperCase(),
      imageType: match[2] ? 'teaThumbnail' : 'tea',
      cacheKeyName: file,
    };
  } catch {
    return null;
  }
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

function discoveryCacheKey(reference, imageType, sourceUrl) {
  return `${String(reference || '').toUpperCase()}|${imageType}|${sourceUrl}`;
}

function reviewCandidateKey(candidate) {
  return crypto.createHash('sha1').update(reviewCandidateIdentity(candidate)).digest('hex');
}

function reviewCandidateIdentity(candidate) {
  const type = normalizeText(candidate?.detection_type || 'review_candidate');
  const reference = normalizeText(candidate?.reference || '').toUpperCase();
  if (type === 'unregistered_reference') return `${type}|${reference}`;
  if (type === 'unregistered_reference_image') return `${type}|${reference}`;
  if (type === 'sales_sku_detected') return `${type}|${reference}`;
  if (type === 'official_name_changed') {
    return `${type}|${reference}|${normalizeText(candidate?.existing_version_key || candidate?.target_version_key || '')}`;
  }
  return `${type}|${reference}|${normalizeText(candidate?.existing_version_key || '')}`;
}

function sourceLanguageFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.endsWith('co.jp')) return 'JP';
    if (url.pathname.startsWith('/en/')) return 'EN';
    if (url.pathname.startsWith('/fr/')) return 'FR';
  } catch {
  }
  return '';
}

function normalizeNameForCompare(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[®™'’`´.,:;!?\-_/()[\]{}]/g, ' ')
    .replace(/\b(the|tea|thes|au|poids|mariage|freres)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function compactSnippet(value, maxLength = 500) {
  return normalizeText(value).replace(/\s+/g, ' ').slice(0, maxLength);
}

function preferredDescriptionByLanguage(descriptionsByLanguage) {
  const descriptions = descriptionsByLanguage && typeof descriptionsByLanguage === 'object' ? descriptionsByLanguage : {};
  for (const language of ['JP', 'EN', 'FR']) {
    const description = compactSnippet(descriptions[language] || '', 1200);
    if (description) return description;
  }
  return '';
}

function normalizeOfficialCategoryForMaster(category) {
  const normalized = normalizeText(category).replace(/™/g, '').toLowerCase();
  if (!normalized) return '';
  const direct = new Map([
    ['thé noir', '黒茶'],
    ['the noir', '黒茶'],
    ['black tea', '黒茶'],
    ['thé bleu', '青茶'],
    ['the bleu', '青茶'],
    ['blue tea', '青茶'],
    ['thé vert', '緑茶'],
    ['green tea', '緑茶'],
    ['thé blanc', '白茶'],
    ['white tea', '白茶'],
    ['rooibos', 'ルイボス'],
    ['infusion', 'インフュージョン'],
    ['herbal tea', 'インフュージョン'],
    ['maté', 'マテ'],
    ['mate', 'マテ'],
  ]);
  if (direct.has(normalized)) return direct.get(normalized);
  if (/thé noir|black tea/.test(normalized)) return '黒茶';
  if (/thé bleu|blue tea|oolong/.test(normalized)) return '青茶';
  if (/thé vert|green tea/.test(normalized)) return '緑茶';
  if (/thé blanc|white tea/.test(normalized)) return '白茶';
  if (/rooibos/.test(normalized)) return 'ルイボス';
  if (/infusion|herbal/.test(normalized)) return 'インフュージョン';
  if (/mat[ée]/.test(normalized)) return 'マテ';
  return normalizeText(category).replace(/\bBlack tea\b/gi, '黒茶').replace(/\bBlue tea\b/gi, '青茶').replace(/\bGreen tea\b/gi, '緑茶').replace(/\bWhite tea\b/gi, '白茶').replace(/\bThé noir\b/gi, '黒茶').replace(/\bThé bleu\b/gi, '青茶').replace(/\bThé vert\b/gi, '緑茶').replace(/\bThé blanc\b/gi, '白茶');
}

function officialDescriptionJapaneseOverrides(config) {
  return config.officialDescriptionJapaneseOverrides && typeof config.officialDescriptionJapaneseOverrides === 'object'
    ? config.officialDescriptionJapaneseOverrides
    : {};
}

function curatedOfficialDescriptionJa(reference, sourceLanguage, originalDescription, config = {}) {
  const normalizedReference = normalizeText(reference).toUpperCase();
  const overrides = officialDescriptionJapaneseOverrides(config);
  if (hasValue(overrides[normalizedReference])) return normalizeText(overrides[normalizedReference]);
  const original = normalizeText(originalDescription);
  if (!original) return '';
  if (sourceLanguage === 'JP') return original;
  return '';
}

function buildOfficialDescriptionBackfillValue({ product, facts, language, config }) {
  const originalDescription = compactSnippet(facts?.productDescription || '', 1200);
  const japaneseDescription = curatedOfficialDescriptionJa(product.reference, language, originalDescription, config);
  return {
    original_description: originalDescription,
    source_language: language || '',
    source_url: facts?.url || product.productUrl || '',
    japanese_description: japaneseDescription,
    needs_translation: Boolean(originalDescription && !japaneseDescription),
  };
}

function buildOfficialDescriptionTranslationReviewCandidate({ product, facts, descriptionValue, category }) {
  return {
    reference: product.reference,
    version_key: product.master?.versionKey || '',
    official_name: facts?.h1 || product.name || '',
    source_language: descriptionValue.source_language,
    source_url: descriptionValue.source_url,
    original_description: descriptionValue.original_description,
    normalized_category: category || '',
    current_master_description: product.master?.officialDescription || '',
    current_master_category: product.master?.officialCategory || '',
    reason: 'Official product description was found only outside JP and needs human-approved Japanese text before master writeback.',
  };
}

function mergeUniqueTextLines(...values) {
  const out = [];
  for (const value of values) {
    for (const line of String(value || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out.join('\n');
}

function mergeObjectValues(left, right) {
  return { ...(left && typeof left === 'object' ? left : {}), ...(right && typeof right === 'object' ? right : {}) };
}

function mergeArrayValues(left, right, keyFn = (item) => JSON.stringify(item)) {
  const out = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function reviewCandidateWriteBackFingerprint(candidate) {
  const copy = { ...(candidate || {}) };
  delete copy.detected_at;
  delete copy.last_seen_at;
  delete copy.last_write_back_at;
  delete copy.write_back_success;
  delete copy.write_back_error;
  return JSON.stringify(copy);
}

function findSimilarMasterCandidates(reference, officialName, masterProducts = []) {
  const normalizedOfficialName = normalizeNameForCompare(officialName);
  if (!normalizedOfficialName) return [];
  const officialTokens = normalizedOfficialName.split(/\s+/).filter((token) => token.length >= 4);
  const scoredByReference = new Map();
  for (const product of masterProducts || []) {
    if (!product?.reference || product.reference === reference) continue;
    const productName = product.name || '';
    const normalizedProductName = normalizeNameForCompare(productName);
    if (!normalizedProductName) continue;
    let score = 0;
    if (normalizedProductName === normalizedOfficialName) score += 100;
    if (normalizedProductName.includes(normalizedOfficialName) || normalizedOfficialName.includes(normalizedProductName)) score += 50;
    for (const token of officialTokens) {
      if (normalizedProductName.split(/\s+/).includes(token)) score += 8;
    }
    if (score <= 0) continue;
    const candidate = {
      reference: product.reference,
      version_key: product.master?.versionKey || '',
      name: productName,
      score,
    };
    const existing = scoredByReference.get(candidate.reference);
    if (!existing || candidate.score > existing.score || (candidate.score === existing.score && candidate.version_key.localeCompare(existing.version_key) < 0)) {
      scoredByReference.set(candidate.reference, candidate);
    }
  }
  return [...scoredByReference.values()]
    .sort((a, b) => b.score - a.score || a.reference.localeCompare(b.reference))
    .slice(0, 5);
}

async function extractOfficialName(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const selectors = [
      'h1.page-title span',
      'h1.page-title',
      '.page-title-wrapper h1 span',
      '.page-title-wrapper h1',
      'h1',
      '[itemprop="name"]',
    ];
    for (const selector of selectors) {
      const value = clean(document.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return clean(document.title).replace(/\s*\|\s*MARIAGE\s+FR[ÈE]RES.*$/i, '');
  }).catch(() => '');
}

function officialNameReviewCandidate(product, officialName, pageUrl) {
  const existingName = normalizeText(product.name);
  if (!existingName || !officialName) return null;
  if (normalizeNameForCompare(existingName) === normalizeNameForCompare(officialName)) return null;
  const candidate = {
    detected_at: nowIso(),
    reference: product.reference,
    official_name: officialName,
    detection_type: 'official_name_changed',
    official_url: pageUrl,
    source_language: sourceLanguageFromUrl(pageUrl),
    existing_reference: product.reference,
    existing_version_key: product.master?.versionKey || '',
    existing_name: existingName,
    diff_summary: `Official name differs from the current master name: "${existingName}" -> "${officialName}".`,
    evidence: `verified_product_page=${pageUrl}; exact_reference=${product.reference}`,
    status: '要確認',
    human_decision: '',
    target_version_key: product.master?.versionKey || '',
    comment: '',
  };
  candidate.detection_id = reviewCandidateKey(candidate);
  return candidate;
}

function cacheReviewCandidate(cache, candidate) {
  if (!cache) return false;
  const item = { ...candidate };
  item.detection_id = item.detection_id || reviewCandidateKey(item);
  const existing = cache.review_candidates[item.detection_id];
  if (existing) {
    const beforeFingerprint = reviewCandidateWriteBackFingerprint(existing);
    const languages = new Set(String(existing.source_language || '').split(/[,+\s]+/).filter(Boolean));
    for (const lang of String(item.source_language || '').split(/[,+\s]+/).filter(Boolean)) languages.add(lang);
    const mergedDescriptionSnippets = mergeObjectValues(existing.description_snippets_by_language, item.description_snippets_by_language);
    const merged = {
      ...existing,
      official_name: existing.official_name || item.official_name,
      official_url: existing.official_url || item.official_url,
      source_language: [...languages].join('+') || existing.source_language || item.source_language || '',
      detected_at: existing.detected_at || item.detected_at,
      last_seen_at: item.detected_at || nowIso(),
      existing_reference: existing.existing_reference || item.existing_reference || '',
      existing_version_key: existing.existing_version_key || item.existing_version_key || '',
      existing_name: existing.existing_name || item.existing_name || '',
      target_version_key: existing.target_version_key || item.target_version_key || '',
      fr_official_url: existing.fr_official_url || item.fr_official_url || '',
      en_official_url: existing.en_official_url || item.en_official_url || '',
      jp_official_url: existing.jp_official_url || item.jp_official_url || '',
      official_urls_by_language: mergeObjectValues(existing.official_urls_by_language, item.official_urls_by_language),
      official_names_by_language: mergeObjectValues(existing.official_names_by_language, item.official_names_by_language),
      description_snippets_by_language: mergedDescriptionSnippets,
      categories_by_language: mergeObjectValues(existing.categories_by_language, item.categories_by_language),
      official_category: existing.official_category || item.official_category || '',
      discovery_sources: mergeArrayValues(existing.discovery_sources, item.discovery_sources, (entry) => `${entry.source || ''}|${entry.url || ''}`),
      similar_master_candidates: mergeArrayValues(existing.similar_master_candidates, item.similar_master_candidates, (entry) => entry.reference || entry.version_key || JSON.stringify(entry)).slice(0, 5),
      official_name_differences: mergeUniqueTextLines(existing.official_name_differences, item.official_name_differences),
      description_excerpt: preferredDescriptionByLanguage(mergedDescriptionSnippets) || mergeUniqueTextLines(existing.description_excerpt, item.description_excerpt),
      evidence: mergeUniqueTextLines(existing.evidence, item.evidence),
    };
    if (existing.write_back_success && reviewCandidateWriteBackFingerprint(merged) !== beforeFingerprint) {
      merged.write_back_success = false;
      merged.write_back_error = '';
    }
    cache.review_candidates[item.detection_id] = merged;
    return false;
  }
  cache.review_candidates[item.detection_id] = item;
  return true;
}

function ensureDiscoveryCacheShape(cache) {
  const shaped = cache && typeof cache === 'object' ? cache : {};
  shaped.images = shaped.images && typeof shaped.images === 'object' ? shaped.images : {};
  shaped.review_candidates = shaped.review_candidates && typeof shaped.review_candidates === 'object' ? shaped.review_candidates : {};
  return shaped;
}

function loadDiscoveryCache(filePath) {
  return ensureDiscoveryCacheShape(readJson(filePath, { images: {} }));
}

function discoveryCacheCandidates(cache, product) {
  const reference = String(product.reference || '').toUpperCase();
  return Object.values(cache.images || {})
    .filter((entry) => entry.reference === reference && ['url_ref_exact', 'current_verified_product_page'].includes(entry.verification_status))
    .map((entry) => ({
      sourceKind: 'discovery_cache',
      url: entry.source_url,
      sourceUrl: entry.source_url,
      width: entry.width || 0,
      height: entry.height || 0,
      naturalWidth: entry.width || 0,
      naturalHeight: entry.height || 0,
      mimeType: entry.mime_type || '',
      closestText: `${entry.reference} ${entry.image_type}`,
      sectionText: entry.image_type === 'liqueur' ? 'Liqueur color_liqueur' : entry.reference,
    }));
}

function updateDiscoveryCache({ cache, candidates, product, pageUrl, masterReferences, debug }) {
  const detectedAt = nowIso();
  let added = 0;
  let reviewAdded = 0;
  for (const candidate of candidates) {
    const info = imageInfoFromOfficialUrl(candidate.url);
    if (!info) continue;

    let reference = info.reference;
    let verificationStatus = 'url_ref_exact';
    if (info.imageType === 'liqueur') {
      if (!isProductContextLiqueurCandidate(candidate)) continue;
      reference = String(product.reference || '').toUpperCase();
      verificationStatus = 'current_verified_product_page';
    }
    if (!reference) continue;
    if (!masterReferences.has(reference)) {
      if (info.imageType !== 'liqueur') {
        const review = {
          detected_at: detectedAt,
          reference,
          official_name: '',
          detection_type: 'unregistered_reference_image',
          official_url: candidate.url,
          source_language: sourceLanguageFromUrl(pageUrl),
          existing_reference: '',
          existing_version_key: '',
          existing_name: '',
          diff_summary: `Unregistered ${reference} ${info.imageType} image was discovered while collecting an official page.`,
          evidence: `image_type=${info.imageType}; image_url=${candidate.url}; discovered_from_page=${pageUrl}`,
          status: '要確認',
          human_decision: '',
          target_version_key: '',
          comment: '',
        };
        if (cacheReviewCandidate(cache, review)) reviewAdded += 1;
      }
      continue;
    }

    const key = discoveryCacheKey(reference, info.imageType, candidate.url);
    if (cache.images[key]) {
      cache.images[key] = {
        ...cache.images[key],
        last_seen_at: detectedAt,
        seen_count: (cache.images[key].seen_count || 1) + 1,
      };
      continue;
    }

    cache.images[key] = {
      reference,
      image_type: info.imageType,
      source_url: candidate.url,
      discovered_from_page: pageUrl,
      detected_at: detectedAt,
      last_seen_at: detectedAt,
      seen_count: 1,
      verification_status: verificationStatus,
      width: candidate.naturalWidth || candidate.width || 0,
      height: candidate.naturalHeight || candidate.height || 0,
      mime_type: candidate.mimeType || '',
    };
    added += 1;
  }
  if (debug && (added || reviewAdded)) console.log(`[opportunistic] cached ${added} image candidate(s), ${reviewAdded} review candidate(s) from ${product.reference}`);
  return added;
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

function productSearchUrls(query) {
  const fr = new URL('https://www.mariagefreres.com/fr/catalogsearch/result/');
  fr.searchParams.set('q', query);
  const en = new URL('https://www.mariagefreres.com/en/catalogsearch/result/');
  en.searchParams.set('q', query);
  const jp = new URL('https://www.mariagefreres.co.jp/view/search');
  jp.searchParams.set('search_keyword', query);
  return [fr.href, en.href, jp.href];
}

function looksLikeProductUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'www.mariagefreres.com' && (parsed.pathname.startsWith('/fr/') || parsed.pathname.startsWith('/en/'))) {
      if (!parsed.pathname.endsWith('.html')) return false;
      if (/checkout|customer|catalogsearch|wishlist|review|contacts/i.test(parsed.pathname)) return false;
      if (!/(^|-)t\d{2,5}([-.]|$)/i.test(parsed.pathname)) return false;
      return true;
    }
    if (parsed.hostname === 'www.mariagefreres.co.jp' && /^\/view\/item\/\d+/.test(parsed.pathname)) {
      return true;
    }
    return false;
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

async function discoverProductPageUrl(context, product, config, debug, discoveryCache = null, masterReferences = new Set()) {
  const page = await context.newPage();
  const queries = productSearchQueries(product);
  const seen = new Set();
  const attempted = [];
  const startedAt = nowIso();

  try {
    for (const query of queries) {
      for (const searchUrl of productSearchUrls(query)) {
        if (debug) console.log(`[url-search] ${product.reference} query=${query} ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 90000 });
        await page.waitForLoadState('networkidle', { timeout: config.networkIdleTimeoutMs || 45000 }).catch(() => {});
        await sleep(config.settleDelayMs || 2500);

        const title = await page.title().catch(() => '');
        const bodyText = await page.locator('body').innerText({ timeout: 5000 });
        if (/cloudflare|verify you are human|vérifiez que vous êtes humain|just a moment/i.test(`${title}\n${bodyText}`)) {
          return {
            success: false,
            status: 'error',
            discovery_version: PRODUCT_URL_DISCOVERY_VERSION,
            method: 'official_search',
            searched_queries: queries,
            attempted_urls: attempted,
            acquired_at: startedAt,
            error_message: 'Official search is blocked by browser verification.',
          };
        }
        if (/aucun résultat|aucun resultat|no results|該当する商品がありません/i.test(bodyText)) {
          if (debug) console.log(`[url-search-empty] ${product.reference} query=${query}`);
          continue;
        }

        const candidates = await collectProductSearchCandidates(page);
        for (const candidate of candidates) {
          for (const token of candidateReferenceTokens(candidate)) {
            if (token === String(product.reference || '').toUpperCase()) continue;
            if (masterReferences.has(token)) continue;
            cacheReviewCandidate(discoveryCache, {
              detected_at: nowIso(),
              reference: token,
              official_name: candidate.text || '',
              detection_type: 'unregistered_reference_search_result',
              official_url: candidate.href,
              source_language: sourceLanguageFromUrl(candidate.href || searchUrl),
              existing_reference: '',
              existing_version_key: '',
              existing_name: '',
              diff_summary: `Unregistered ${token} was discovered in official search results.`,
              evidence: `search_url=${searchUrl}; query=${query}; result_text=${candidate.text || candidate.closestText || ''}`,
              status: '要確認',
              human_decision: '',
              target_version_key: '',
              comment: '',
            });
          }
        }
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
          const visibleText = await page.locator('body').innerText({ timeout: 8000 });
          if (/cloudflare|verify you are human|vérifiez que vous êtes humain|just a moment/i.test(`${titleText}\n${visibleText}`)) {
            return {
              success: false,
              status: 'error',
              discovery_version: PRODUCT_URL_DISCOVERY_VERSION,
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
              discovery_version: PRODUCT_URL_DISCOVERY_VERSION,
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
    }

    return {
      success: false,
      status: 'not_found',
      discovery_version: PRODUCT_URL_DISCOVERY_VERSION,
      method: 'official_search',
      searched_queries: queries,
      attempted_urls: attempted,
      acquired_at: startedAt,
      error_message: PRODUCT_URL_NOT_FOUND_MESSAGE,
    };
  } catch (error) {
    return {
      success: false,
      status: 'error',
      discovery_version: PRODUCT_URL_DISCOVERY_VERSION,
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
  discoveryCache = null,
  masterReferences = new Set(),
}) {
  const pageInfo = await getProductPage(context, product, { useExistingPages });
  const page = pageInfo.page;
  const pageUrl = product.productUrl;
  const cdp = await createCdpNetworkCapture(page, debug);
  const startedAt = Date.now();
  const result = { reference: product.reference, pageUrl, images: {}, successCount: 0, reviewCandidates: [] };

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
    const officialName = await extractOfficialName(page);
    const nameReview = officialNameReviewCandidate(product, officialName, page.url());
    if (nameReview) result.reviewCandidates.push(nameReview);

    const domCandidates = await collectDomCandidates(page, pageUrl);
    const cacheCandidates = await collectCacheApiCandidates(page);
    const networkCandidates = [...cdp.bodies.values()].map((entry) => ({
      sourceKind: 'network',
      url: entry.url,
      mimeType: entry.mimeType,
      width: 0,
      height: 0,
    }));
    const discoveredCandidates = discoveryCache ? discoveryCacheCandidates(discoveryCache, product) : [];
    const allCandidates = [...domCandidates, ...cacheCandidates, ...networkCandidates, ...discoveredCandidates];
    if (discoveryCache) {
      updateDiscoveryCache({ cache: discoveryCache, candidates: allCandidates, product, pageUrl, masterReferences, debug });
    }

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
        JSON.stringify({ product, title, domCandidates, cacheCandidates, networkCandidates, discoveredCandidates }, null, 2)
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
  const maxPerRun = config.maxPerRun || 5;
  const retryMaxPerRun = Number.isFinite(config.retryMaxPerRun) ? config.retryMaxPerRun : 1;
  const retryBackoffMs = Number.isFinite(config.retryBackoffMs) ? config.retryBackoffMs : 6 * 60 * 60 * 1000;
  const now = Date.now();
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
  if (refs?.length) {
    return merged.filter((product) => refs.includes(product.reference));
  }

  const pending = [];
  const retry = [];
  for (const product of merged) {
    const localStatus = product.status || '';
    const masterStatus = product.master_status || 'pending';
    const currentUrlNotFound = isCurrentDiscoveryNotFoundResult(product.urlDiscovery);
    const legacyUrlNotFound = hasLegacyDiscoveryNotFoundResult(product.urlDiscovery);
    const urlDiscoveryStatus = currentUrlNotFound
      ? 'not_found'
      : legacyUrlNotFound
        ? ''
        : normalizeProductUrlStatus(product.urlDiscovery?.status) || '';
    const status = hasMasterProducts && masterStatus !== 'complete' && localStatus === 'complete'
      ? masterStatus
      : legacyUrlNotFound
        ? masterStatus
        : localStatus || masterStatus;
    const retryCount = product.retry_count || 0;
    if (!hasValue(product.productUrl) && (urlDiscoveryStatus === 'not_found' || (localStatus === 'not_found' && currentUrlNotFound))) continue;
    if (status === 'complete' || status === 'not_found') continue;

    const isRetry = status === 'retry' || status === 'error';
    if (isRetry) {
      if (retryCount >= maxRetries) continue;
      const lastAttemptAt = parseTime(product.last_attempt_at || product.updated_at || product.urlDiscovery?.acquired_at);
      if (lastAttemptAt && now - lastAttemptAt < retryBackoffMs) continue;
      retry.push(product);
      continue;
    }

    if (['pending', 'partial'].includes(status) || product.master_status === 'partial') {
      pending.push(product);
    }
  }

  if (pending.length === 0) {
    return retry.slice(0, maxPerRun);
  }
  const selectedRetry = retry.slice(0, Math.min(retryMaxPerRun, maxPerRun));
  const selectedPending = pending.slice(0, maxPerRun - selectedRetry.length);
  return selectedRetry.concat(selectedPending);
}

function productScheduleStatus(product) {
  const localStatus = product.status || '';
  const masterStatus = product.master_status || productImageStatus(product);
  if (hasLegacyDiscoveryNotFoundResult(product.urlDiscovery)) return 'legacy_not_found_recheck';
  const urlDiscoveryStatus = isCurrentDiscoveryNotFoundResult(product.urlDiscovery)
    ? 'not_found'
    : normalizeProductUrlStatus(product.urlDiscovery?.status) || '';
  if (masterStatus === 'complete' || localStatus === 'complete') return 'complete';
  if (localStatus === 'not_found' && isCurrentDiscoveryNotFoundResult(product.urlDiscovery)) return 'not_found';
  if (!hasValue(product.productUrl) && urlDiscoveryStatus === 'not_found') return 'not_found';
  if (localStatus === 'retry') return 'retry';
  if (localStatus === 'error') return 'error';
  if (masterStatus === 'partial' || localStatus === 'partial') return 'partial';
  return 'pending';
}

function masterImageResolved(product, imageType) {
  if (imageType === 'tea') return hasValue(product.master?.teaImageUrl) || product.master?.teaImageStatus === 'not_available';
  if (imageType === 'teaThumbnail') return hasValue(product.master?.teaThumbnailUrl) || product.master?.teaThumbnailStatus === 'not_available';
  if (imageType === 'liqueur') return hasValue(product.master?.liqueurImageUrl) || product.master?.liqueurImageStatus === 'not_available';
  return false;
}

function discoveryCacheStats(cache, masterProducts = []) {
  const entries = Object.values(cache?.images || {});
  const reviewEntries = Object.values(cache?.review_candidates || {});
  const masterByReference = new Map(masterProducts.map((product) => [product.reference, product]));
  const unapplied = entries.filter((entry) => {
    const product = masterByReference.get(entry.reference);
    return product && !masterImageResolved(product, entry.image_type);
  });
  return {
    image_count: entries.length,
    unapplied_image_count: unapplied.length,
    review_candidate_count: reviewEntries.length,
    unposted_review_candidate_count: reviewEntries.filter((entry) => !entry.write_back_success).length,
  };
}

function newReferenceDiscoveryStats(state) {
  const sources = Object.values(state?.sources || {});
  return {
    source_count: sources.length,
    queued_url_count: sources.reduce((sum, source) => sum + (source.queue?.length || 0), 0),
    visited_url_count: sources.reduce((sum, source) => sum + Object.keys(source.visited_urls || {}).length, 0),
    discovered_reference_count: Object.keys(state?.discovered_references || {}).length,
    last_started_at: state?.last_started_at || '',
    last_success_at: state?.last_success_at || '',
    last_full_rescan_started_at: state?.last_full_rescan_started_at || '',
    full_rescan_count: state?.full_rescan_count || 0,
  };
}

async function writeBackReviewCandidates({ config, baseDir, candidates, debug }) {
  if (!writeBackRequired(config) || !candidates?.length) return [];
  const results = [];
  for (const candidate of candidates) {
    try {
      const result = await writeBackReviewCandidate({ config, baseDir, candidate, debug });
      results.push({ detection_id: candidate.detection_id, success: true, result });
    } catch (error) {
      results.push({ detection_id: candidate.detection_id, success: false, error_message: error.message });
      if (debug) console.log(`[review-writeback-failed] ${candidate.reference} ${candidate.detection_type} ${error.message}`);
    }
  }
  return results;
}

function reviewCandidateReadyForWriteBack(candidate) {
  if (candidate?.detection_type === 'sales_sku_detected') {
    return hasValue(candidate.existing_reference);
  }
  return true;
}

function markReviewWriteBackResults(discoveryCache, results) {
  for (const result of results || []) {
    const entry = discoveryCache?.review_candidates?.[result.detection_id];
    if (!entry) continue;
    entry.last_write_back_at = nowIso();
    entry.write_back_success = result.success;
    entry.write_back_error = result.error_message || '';
  }
}

function buildStatusSummary(config, state, master, products, discoveryCache = null, newReferenceDiscoveryState = null) {
  const counts = {
    complete: 0,
    pending: 0,
    not_found: 0,
    legacy_not_found_recheck: 0,
    retry: 0,
    error: 0,
    partial: 0,
  };
  const sourceProducts = master?.products || config.products || [];
  for (const product of sourceProducts) {
    const localState = state.products?.[product.reference] || {};
    const merged = {
      ...product,
      master_status: productImageStatus(product),
      ...localState,
      productUrl: product.productUrl || localState.productUrl,
    };
    const status = productScheduleStatus(merged);
    counts[status] = (counts[status] || 0) + 1;
  }
  return {
    master_rows: master?.rowCount || 0,
    product_count: sourceProducts.length,
    counts,
    opportunistic_cache: discoveryCacheStats(discoveryCache, sourceProducts),
    new_reference_discovery: newReferenceDiscoveryStats(newReferenceDiscoveryState),
    next_candidates: products.map((product) => ({
      reference: product.reference,
      name: product.name || '',
      product_url: product.productUrl || '',
      master_status: product.master_status || 'pending',
      state_status: state.products?.[product.reference]?.status || '',
      url_discovery_status: hasLegacyDiscoveryNotFoundResult(product.urlDiscovery)
        ? 'legacy_not_found_recheck'
        : normalizeProductUrlStatus(product.urlDiscovery?.status) || product.master?.productUrlStatus || '',
      discovery_version: normalizeText(product.urlDiscovery?.discovery_version),
    })),
  };
}

async function normalizeNotFoundProductUrlWriteBacks({ config, baseDir, state, master, debug }) {
  if (!writeBackRequired(config) || !master?.products?.length) return;
  for (const product of master.products) {
    const localState = state.products?.[product.reference];
    const masterUrlStatus = normalizeProductUrlStatus(product.master?.productUrlStatus);
    if (hasValue(product.master?.productUrl) || masterUrlStatus === 'not_found' || !isCurrentDiscoveryNotFoundResult(localState?.urlDiscovery)) {
      continue;
    }
    const discovery = {
      success: false,
      status: 'not_found',
      discovery_version: PRODUCT_URL_DISCOVERY_VERSION,
      url: '',
      error_message: localState.urlDiscovery?.error_message || PRODUCT_URL_NOT_FOUND_MESSAGE,
    };
    try {
      await writeBackProductPageUrl({ config, baseDir, product, discovery, debug });
      if (debug) console.log(`[url-status-normalized] ${product.reference} not_found`);
    } catch (error) {
      if (debug) console.log(`[url-status-normalize-failed] ${product.reference} ${error.message}`);
    }
  }
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
    last_attempt_at: nowIso(),
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

function defaultNewReferenceDiscoverySources() {
  return [
    {
      id: 'official-sitemaps',
      language: '',
      source: 'sitemap',
      seedUrls: [
        'https://www.mariagefreres.com/sitemap.xml',
        'https://www.mariagefreres.co.jp/sitemap.xml',
      ],
    },
    {
      id: 'jp-all-products',
      language: 'JP',
      source: 'category',
      seedUrls: [
        'https://www.mariagefreres.co.jp/view/search',
        'https://www.mariagefreres.co.jp/view/category/ct208',
      ],
    },
    {
      id: 'fr-main-categories',
      language: 'FR',
      source: 'category',
      seedUrls: [
        'https://www.mariagefreres.com/fr/the/les-moments-du-the.html',
        'https://www.mariagefreres.com/fr/the/les-grandes-familles.html',
        'https://www.mariagefreres.com/fr/the/les-thes-icones.html',
      ],
    },
    {
      id: 'en-main-categories',
      language: 'EN',
      source: 'category',
      seedUrls: [
        'https://www.mariagefreres.com/en/tea/fragrance.html',
        'https://www.mariagefreres.com/en/collection',
      ],
    },
  ];
}

function normalizeNewReferenceDiscoveryState(state, sources) {
  const shaped = state && typeof state === 'object' ? state : {};
  shaped.version = shaped.version || 'new-reference-discovery-v1';
  shaped.sources = shaped.sources && typeof shaped.sources === 'object' ? shaped.sources : {};
  shaped.discovered_references = shaped.discovered_references && typeof shaped.discovered_references === 'object' ? shaped.discovered_references : {};
  shaped.full_rescan_count = Number.isFinite(shaped.full_rescan_count) ? shaped.full_rescan_count : 0;
  for (const source of sources) {
    const current = shaped.sources[source.id] && typeof shaped.sources[source.id] === 'object' ? shaped.sources[source.id] : {};
    current.queue = Array.isArray(current.queue) ? current.queue : [...source.seedUrls];
    current.visited_urls = current.visited_urls && typeof current.visited_urls === 'object' ? current.visited_urls : {};
    current.errors = current.errors && typeof current.errors === 'object' ? current.errors : {};
    shaped.sources[source.id] = current;
  }
  return shaped;
}

function resetNewReferenceDiscoveryQueues(state, sources, startedAt) {
  for (const source of sources) {
    state.sources[source.id] = {
      ...(state.sources[source.id] || {}),
      queue: [...source.seedUrls],
      visited_urls: {},
      errors: {},
      full_rescan_started_at: startedAt,
    };
  }
  state.last_full_rescan_started_at = startedAt;
  state.full_rescan_count = (state.full_rescan_count || 0) + 1;
}

function shouldStartNewReferenceFullRescan(state, intervalDays) {
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) return false;
  if (!state.last_full_rescan_started_at) return true;
  const last = Date.parse(state.last_full_rescan_started_at);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= intervalDays * 24 * 60 * 60 * 1000;
}

function extractTeaReferences(text) {
  const out = new Set();
  const pattern = /(^|[^A-Za-z0-9])(T\d{2,6})(?![A-Za-z0-9])/g;
  for (const match of String(text || '').matchAll(pattern)) out.add(match[2].toUpperCase());
  return [...out];
}

function extractSalesSkuReferences(text) {
  const out = new Set();

  const pattern =
    /(^|[^A-Za-z0-9])((?:TFG|TJC|TB|TC|TE|TF|TP|TA)\d{2,6}|TJ[A-Z0-9]{2,8})(?![A-Za-z0-9])/gi;

  for (const match of String(text || '').matchAll(pattern)) {
    out.add(match[2].toUpperCase());
  }

  return [...out];
}

function salesSkuParts(sku) {
  const normalized = String(sku || '').trim().toUpperCase();
  const numeric = normalized.match(/^(TFG|TJC|TB|TC|TE|TF|TP|TA)(\d{2,6})$/);
  if (numeric) {
    return { sku: normalized, prefix: numeric[1], suffix: numeric[2], numericSuffix: true };
  }
  const tj = normalized.match(/^(TJ)([A-Z0-9]{2,8})$/);
  if (tj) {
    return { sku: normalized, prefix: tj[1], suffix: tj[2], numericSuffix: false };
  }
  return null;
}

function teaReferenceNumber(reference) {
  return String(reference || '').trim().toUpperCase().match(/^T(\d+)$/)?.[1] || '';
}

function findMasterProductByReference(masterProducts, reference) {
  const normalized = String(reference || '').trim().toUpperCase();
  return (masterProducts || []).find((product) => String(product.reference || '').toUpperCase() === normalized) || null;
}

function resolveSalesSkuParent({ sku, pageRefs, masterProducts }) {
  const parts = salesSkuParts(sku);
  if (!parts) return null;
  const refs = [...(pageRefs || [])].map((ref) => String(ref || '').toUpperCase()).filter((ref) => /^T\d+$/.test(ref));
  if (!refs.length) return null;

  let parentReference = '';
  if (parts.numericSuffix) {
    parentReference = refs.find((ref) => teaReferenceNumber(ref) === parts.suffix) || '';
    if (!parentReference) return null;
  } else if (refs.length === 1) {
    parentReference = refs[0];
  } else {
    return null;
  }

  const product = findMasterProductByReference(masterProducts, parentReference);
  return {
    reference: parentReference,
    versionKey: product?.master?.versionKey || '',
    name: product?.name || '',
    inMaster: Boolean(product),
  };
}

function isJpRetailSkuLikeTeaReference(reference, facts) {
  const ref = String(reference || '').toUpperCase();
  const url = String(facts?.url || facts?.canonical || '');
  if (sourceLanguageFromUrl(url) !== 'JP') return false;
  const digits = ref.match(/^T(\d+)$/)?.[1] || '';
  if (digits.length < 6) return false;
  const productText = `${facts?.title || ''}\n${facts?.h1 || ''}\n${facts?.snippet || ''}\n${facts?.bodyText || ''}`;
  return /\d+\s*g|￥|カートに追加|Buy|ロゴ袋入り|商品について問い合わせる/i.test(productText);
}

function extractVerifiedProductTeaReferences(text, facts) {
  return extractTeaReferences(text).filter((reference) => !isJpRetailSkuLikeTeaReference(reference, facts));
}

function extractUrlsFromText(text) {
  return [...new Set([...String(text || '').matchAll(/https?:\/\/[^\s<>"']+/gi)].map((match) => match[0].replace(/[),.;]+$/, '')))];
}

function isDiscoveryListUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'www.mariagefreres.com') {
      if (url.pathname.includes('/catalogsearch/')) return true;
      if (url.pathname.startsWith('/fr/the/') || url.pathname.startsWith('/en/tea/') || url.pathname.startsWith('/fr/collection') || url.pathname.startsWith('/en/collection')) return true;
    }
    if (url.hostname === 'www.mariagefreres.co.jp') {
      if (url.pathname.startsWith('/view/search') || url.pathname.startsWith('/view/category/')) return true;
    }
  } catch {
  }
  return false;
}

function enqueueDiscoveryUrl(sourceState, url, limit) {
  if (!url || sourceState.visited_urls[url]) return false;
  if (sourceState.queue.includes(url)) return false;
  if (sourceState.queue.length >= limit) return false;
  sourceState.queue.push(url);
  return true;
}

function prependDiscoveryUrl(sourceState, url, limit) {
  if (!url || sourceState.visited_urls[url]) return false;
  if (sourceState.queue.includes(url)) return false;
  if (sourceState.queue.length >= limit) return false;
  sourceState.queue.unshift(url);
  return true;
}

async function collectDiscoveryPageFacts(page, pageUrl) {
  return page.evaluate(() => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isCommonDescription = (value) => /Maison de Thé Restaurant|La plus large carte de thé au monde|Receive Mariage Frères' newsletter|PROLONGEZ L'EXPÉRIENCE|CONTINUE THE EXPERIENCE/i.test(clean(value));
    const productDescriptionSelectors = [
      '.product.attribute.overview .value',
      '.product.attribute.overview',
      '[itemprop="description"]',
      '.product-info-main [data-role="content"]',
    ];
    const productDescription = (() => {
      for (const selector of productDescriptionSelectors) {
        const text = clean(document.querySelector(selector)?.innerText || document.querySelector(selector)?.textContent || '');
        if (text && !isCommonDescription(text)) return text;
      }
      const mainText = clean(document.querySelector('main')?.innerText || '');
      const match = mainText.match(/\bDESCRIPTION\b\s+(.+?)(?:\s+\bLIQUEUR\b|\s+\bBREWING TIPS\b|\s+\bCONSEILS D'INFUSION\b|\s+\bJARDIN PREMIER\b|\s+\bDELIVERY DETAILS\b|\s+\bDÉTAILS DE LIVRAISON\b|$)/i);
      return match && !isCommonDescription(match[1]) ? clean(match[1]) : '';
    })();
    const category = (() => {
      const crumbs = [...document.querySelectorAll('.breadcrumbs a, .items.breadcrumbs a, .breadcrumbs li, .items.breadcrumbs li')]
        .map((node) => clean(node.innerText || node.textContent || ''))
        .filter(Boolean);
      const uniqueCrumbs = crumbs.filter((crumb, index) => crumbs.indexOf(crumb) === index);
      const familyIndex = uniqueCrumbs.findIndex((crumb) => /^(Tea family|Famille de thé|Famille du thé|Les Grandes Familles)$/i.test(crumb));
      const categoryText = familyIndex >= 0 ? uniqueCrumbs[familyIndex + 1] : '';
      if (!categoryText || /^(Home|TEA|THÉ|Tea family|Famille de thé|Famille du thé|Les Grandes Familles)$/i.test(categoryText)) return '';
      return categoryText;
    })();
    const title = clean(document.title);
    const h1 = clean(document.querySelector('h1')?.textContent);
    const bodyText = clean(document.body?.innerText || document.body?.textContent || '');
    const metaDescription = clean(document.querySelector('meta[name="description"]')?.content || '');
    const description = isCommonDescription(metaDescription) ? '' : metaDescription;
    const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
    const links = [...document.querySelectorAll('a[href]')].map((anchor) => ({
      href: anchor.href,
      text: clean(anchor.innerText || anchor.textContent),
      closestText: clean(anchor.closest('.product-item, li, article, .item, .product, .item-list, .prd-list')?.innerText || ''),
    }));
    return {
      title,
      h1,
      bodyText: bodyText.slice(0, 50000),
      description,
      metaDescription,
      productDescription,
      category,
      canonical,
      links,
      snippet: (productDescription || description || '').slice(0, 800),
      url: location.href,
    };
  }, pageUrl);
}

function buildUnregisteredReferenceReview({ reference, facts, url, source, sourceLanguage, discoverySource, snippet, masterProducts }) {
  const officialName = facts?.h1 || facts?.title || '';
  const language = sourceLanguageFromUrl(url) || sourceLanguage || sourceLanguageFromUrl(facts?.url);
  const productDescription = compactSnippet(facts?.productDescription || '', 1200);
  const descriptionExcerpt = preferredDescriptionByLanguage(language && productDescription ? { [language]: productDescription } : {});
  const officialUrlsByLanguage = language ? { [language]: url } : {};
  const officialNamesByLanguage = language && officialName ? { [language]: officialName } : {};
  const descriptionSnippetsByLanguage = language && descriptionExcerpt ? { [language]: descriptionExcerpt } : {};
  const categoriesByLanguage = language && facts?.category ? { [language]: facts.category } : {};
  const similarMasterCandidates = findSimilarMasterCandidates(reference, officialName, masterProducts);
  const candidate = {
    detected_at: nowIso(),
    reference,
    official_name: officialName,
    detection_type: 'unregistered_reference',
    official_url: url,
    source_language: language,
    existing_reference: '',
    existing_version_key: '',
    existing_name: '',
    diff_summary: `Official ${reference} was found but is not present in the current master.`,
    evidence: `discovery_source=${discoverySource}; source=${source.id}; url=${url}; snippet=${snippet || facts?.snippet || ''}`,
    fr_official_url: language === 'FR' ? url : '',
    en_official_url: language === 'EN' ? url : '',
    jp_official_url: language === 'JP' ? url : '',
    official_urls_by_language: officialUrlsByLanguage,
    official_names_by_language: officialNamesByLanguage,
    description_snippets_by_language: descriptionSnippetsByLanguage,
    categories_by_language: categoriesByLanguage,
    official_category: facts?.category || '',
    discovery_sources: [{ source: source.id, source_type: source.source, discovery_source: discoverySource, language, url }],
    official_name_differences: Object.entries(officialNamesByLanguage).map(([lang, name]) => `${lang}: ${name}`).join('\n'),
    description_excerpt: descriptionExcerpt,
    master_absence_confirmed: true,
    similar_master_candidates: similarMasterCandidates,
    status: '要確認',
    human_decision: '',
    target_version_key: '',
    comment: '',
  };
  candidate.detection_id = reviewCandidateKey(candidate);
  return candidate;
}

function buildSalesSkuReview({ sku, facts, url, source, sourceLanguage, discoverySource, snippet, parent }) {
  const candidate = {
    detected_at: nowIso(),
    reference: sku,
    official_name: facts?.h1 || facts?.title || '',
    detection_type: 'sales_sku_detected',
    official_url: url,
    source_language: sourceLanguage || sourceLanguageFromUrl(url),
    existing_reference: parent?.reference || '',
    existing_version_key: parent?.versionKey || '',
    existing_name: parent?.name || '',
    diff_summary: `Official sales SKU ${sku} was detected for ${parent?.reference || 'an unresolved tea reference'}. It is not treated as a tea reference.`,
    evidence: `discovery_source=${discoverySource}; source=${source.id}; url=${url}; parent_reference=${parent?.reference || ''}; parent_in_master=${parent?.inMaster === true}; snippet=${snippet || facts?.snippet || ''}`,
    status: '要確認',
    human_decision: '',
    target_version_key: parent?.versionKey || '',
    comment: '',
  };
  candidate.detection_id = reviewCandidateKey(candidate);
  return candidate;
}

function selectOfficialDescriptionBackfillProducts(masterProducts, refs = null) {
  const refFilter = refs?.length ? new Set(refs.map((ref) => String(ref || '').toUpperCase())) : null;
  return (masterProducts || []).filter((product) => {
    if (refFilter && !refFilter.has(String(product.reference || '').toUpperCase())) return false;
    if (!hasValue(product.productUrl)) return false;
    return !hasValue(product.master?.officialDescription);
  });
}

async function runOfficialDescriptionBackfill({ context, config, master, baseDir, args }) {
  const products = selectOfficialDescriptionBackfillProducts(master?.products || [], args.refs);
  const translationReviewCandidates = [];
  console.log(JSON.stringify({
    official_description_backfill: 'selected',
    master_rows: master?.rowCount || 0,
    selected: products.length,
    dry_run: args.dryRun,
  }));

  for (const product of products) {
    const page = await context.newPage();
    let result;
    try {
      await page.goto(product.productUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 45000 });
      await page.waitForTimeout(config.afterNavigationWaitMs || 1200);
      const facts = await collectDiscoveryPageFacts(page, product.productUrl);
      const combinedText = `${facts.title}\n${facts.h1}\n${facts.bodyText}`;
      const pageRefs = new Set(extractVerifiedProductTeaReferences(combinedText, facts));
      const exactReferenceVerified = pageRefs.has(product.reference);
      const language = sourceLanguageFromUrl(facts.url) || sourceLanguageFromUrl(product.productUrl);
      const descriptionValue = buildOfficialDescriptionBackfillValue({ product, facts, language, config });
      const category = !hasValue(product.master?.officialCategory) ? normalizeOfficialCategoryForMaster(facts.category || '') : '';

      result = {
        reference: product.reference,
        version_key: product.master?.versionKey || '',
        official_name: facts.h1 || product.name || '',
        source_url: facts.url || product.productUrl,
        source_language: descriptionValue.source_language,
        exact_reference_verified: exactReferenceVerified,
        original_description: descriptionValue.original_description,
        planned_japanese_description: descriptionValue.japanese_description,
        needs_translation: descriptionValue.needs_translation,
        category,
        would_update_description: exactReferenceVerified && !hasValue(product.master?.officialDescription) && hasValue(descriptionValue.japanese_description),
        would_update_category: exactReferenceVerified && !hasValue(product.master?.officialCategory) && hasValue(category),
        dry_run: args.dryRun,
      };

      if (!exactReferenceVerified) {
        result.status = 'skipped';
        result.error = 'Product page did not verify the exact master reference.';
      } else if (!descriptionValue.original_description) {
        result.status = 'skipped';
        result.error = 'Product-specific DOM description was not found.';
      } else if (!descriptionValue.japanese_description) {
        result.status = 'translation_review_required';
        result.error = 'Japanese official description is not available yet. Add an officialDescriptionJapaneseOverrides entry or use a JP official page description.';
        result.translation_review_candidate = buildOfficialDescriptionTranslationReviewCandidate({ product, facts, descriptionValue, category });
        translationReviewCandidates.push(result.translation_review_candidate);
      } else if (!args.dryRun && writeBackRequired(config)) {
        const writeBack = await writeBackMasterOfficialInfo({
          config,
          baseDir,
          product,
          officialInfo: {
            description: descriptionValue.japanese_description,
            originalDescription: descriptionValue.original_description,
            category,
            language: descriptionValue.source_language,
            sourceUrl: descriptionValue.source_url,
          },
          debug: args.debug,
        });
        result.status = 'updated';
        result.write_back = writeBack;
      } else {
        result.status = args.dryRun ? 'dry_run' : 'write_back_disabled';
      }
    } catch (error) {
      result = {
        reference: product.reference,
        version_key: product.master?.versionKey || '',
        source_url: product.productUrl,
        status: 'error',
        error: error.message,
        dry_run: args.dryRun,
      };
    } finally {
      await page.close().catch(() => {});
    }
    console.log(JSON.stringify({ official_description_backfill: result }));
  }
  console.log(JSON.stringify({
    official_description_backfill: 'translation_review_candidates',
    count: translationReviewCandidates.length,
    candidates: translationReviewCandidates,
    dry_run: args.dryRun,
  }));
}

async function runNewReferenceDiscovery({ context, config, paths, master, discoveryCache, baseDir, args }) {
  const sources = config.newReferenceDiscovery?.sources || defaultNewReferenceDiscoverySources();
  const state = normalizeNewReferenceDiscoveryState(readJson(paths.newReferenceDiscoveryStateFile, {}), sources);
  const masterProducts = master?.products || [];
  const masterReferences = new Set(masterProducts.map((product) => product.reference).filter(Boolean));
  const maxPages = Number.isFinite(config.newReferenceDiscovery?.maxPagesPerRun) ? config.newReferenceDiscovery.maxPagesPerRun : 8;
  const maxPagesPerSource = Number.isFinite(config.newReferenceDiscovery?.maxPagesPerSourcePerRun)
    ? config.newReferenceDiscovery.maxPagesPerSourcePerRun
    : Math.max(1, Math.ceil(maxPages / Math.max(sources.length, 1)));
  const maxQueue = Number.isFinite(config.newReferenceDiscovery?.maxQueuePerSource) ? config.newReferenceDiscovery.maxQueuePerSource : 200;
  const startedAt = nowIso();
  let processedPages = 0;
  let createdOrQueuedReviews = 0;
  let existingReferences = 0;
  let salesSkus = 0;

  state.last_started_at = startedAt;
  const fullRescanIntervalDays = Number.isFinite(config.newReferenceDiscovery?.fullRescanIntervalDays)
    ? config.newReferenceDiscovery.fullRescanIntervalDays
    : 30;
  if (shouldStartNewReferenceFullRescan(state, fullRescanIntervalDays)) {
    resetNewReferenceDiscoveryQueues(state, sources, startedAt);
  }
  for (const source of sources) {
      if (processedPages >= maxPages) break;
      let sourceProcessedPages = 0;
      const sourceState = state.sources[source.id];
      if (!sourceState.queue.length) sourceState.queue.push(...source.seedUrls);
      sourceState.last_started_at = nowIso();

      while (sourceState.queue.length && processedPages < maxPages && sourceProcessedPages < maxPagesPerSource) {
        const url = sourceState.queue.shift();
        if (sourceState.visited_urls[url]) continue;
        if (args.debug) console.log(`[discover-new] open ${source.id} ${url}`);
        const page = await context.newPage();
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 90000 });
          await page.waitForLoadState('networkidle', { timeout: config.networkIdleTimeoutMs || 45000 }).catch(() => {});
          await sleep(config.settleDelayMs || 2500);
          const facts = await collectDiscoveryPageFacts(page, url);
          const combinedText = `${facts.url}\n${facts.canonical}\n${facts.title}\n${facts.h1}\n${facts.description}\n${facts.bodyText}`;
          if (/cloudflare|verify you are human|vérifiez que vous êtes humain|just a moment/i.test(combinedText)) {
            throw new Error('Discovery page is blocked by browser verification.');
          }

          const pageIsProduct = looksLikeProductUrl(facts.url) || looksLikeProductUrl(facts.canonical || '');
          const pageRefs = new Set(pageIsProduct ? extractVerifiedProductTeaReferences(combinedText, facts) : []);
          const pageSalesSkus = new Set(pageIsProduct ? extractSalesSkuReferences(combinedText) : []);
          const productLinks = [];
          const listLinks = [];
          for (const foundUrl of extractUrlsFromText(combinedText)) {
            if (looksLikeProductUrl(foundUrl)) productLinks.push(foundUrl);
            else if (isDiscoveryListUrl(foundUrl)) listLinks.push(foundUrl);
          }
          for (const link of facts.links || []) {
            const linkText = `${link.href}\n${link.text}\n${link.closestText}`;
            if (pageIsProduct) {
              for (const ref of extractVerifiedProductTeaReferences(linkText, facts)) pageRefs.add(ref);
              for (const sku of extractSalesSkuReferences(linkText)) pageSalesSkus.add(sku);
            }
            if (looksLikeProductUrl(link.href)) productLinks.push(link.href);
            else if (isDiscoveryListUrl(link.href)) listLinks.push(link.href);
          }
          for (const link of [...new Set(productLinks)].reverse()) {
            prependDiscoveryUrl(sourceState, link, maxQueue);
          }
          for (const link of [...new Set(listLinks)]) {
            enqueueDiscoveryUrl(sourceState, link, maxQueue);
          }
          if (facts.canonical && facts.canonical !== facts.url && (looksLikeProductUrl(facts.canonical) || isDiscoveryListUrl(facts.canonical))) {
            enqueueDiscoveryUrl(sourceState, facts.canonical, maxQueue);
          }

          if (pageIsProduct) {
            for (const ref of pageRefs) {
              if (masterReferences.has(ref)) {
                existingReferences += 1;
                const staleReviewId = reviewCandidateKey({ detection_type: 'unregistered_reference', reference: ref });
                if (discoveryCache.review_candidates?.[staleReviewId] && (facts.productDescription || facts.snippet)) {
                  const review = buildUnregisteredReferenceReview({
                    reference: ref,
                    facts,
                    url: facts.canonical || facts.url,
                    source,
                    sourceLanguage: source.language,
                    discoverySource: pageIsProduct ? 'product_page' : source.source,
                    snippet: facts.snippet,
                    masterProducts,
                  });
                  cacheReviewCandidate(discoveryCache, review);
                }
                continue;
              }
              const review = buildUnregisteredReferenceReview({
                reference: ref,
                facts,
                url: facts.canonical || facts.url,
                source,
                sourceLanguage: source.language,
                discoverySource: pageIsProduct ? 'product_page' : source.source,
                snippet: facts.snippet,
                masterProducts,
              });
              if (cacheReviewCandidate(discoveryCache, review)) createdOrQueuedReviews += 1;
              const previousDiscovery = state.discovered_references[ref] || {};
              state.discovered_references[ref] = {
                reference: ref,
                first_seen_at: previousDiscovery.first_seen_at || nowIso(),
                last_seen_at: nowIso(),
                source_language: mergeUniqueTextLines(previousDiscovery.source_language, review.source_language).replace(/\n/g, '+'),
                official_url: previousDiscovery.official_url || review.official_url,
                official_urls_by_language: mergeObjectValues(previousDiscovery.official_urls_by_language, review.official_urls_by_language),
                review_detection_id: review.detection_id,
                in_master: false,
              };
            }

            for (const sku of pageSalesSkus) {
              const parent = resolveSalesSkuParent({ sku, pageRefs, masterProducts });
              if (!parent) {
                if (args.debug) console.log(`[sales-sku-skip] ${sku} did not match verified page reference(s): ${[...pageRefs].join(',')}`);
                continue;
              }
              const review = buildSalesSkuReview({
                sku,
                facts,
                url: facts.canonical || facts.url,
                source,
                sourceLanguage: source.language,
                discoverySource: pageIsProduct ? 'product_page' : source.source,
                snippet: facts.snippet,
                parent,
              });
              if (cacheReviewCandidate(discoveryCache, review)) createdOrQueuedReviews += 1;
              salesSkus += 1;
            }
          }

          sourceState.visited_urls[url] = { visited_at: nowIso(), reference_count: pageRefs.size, product_page: pageIsProduct };
          sourceState.last_success_at = nowIso();
          processedPages += 1;
          console.log(JSON.stringify({
            discovery: 'new_references',
            source: source.id,
            url: facts.url,
            refs_found: pageRefs.size,
            existing_refs_seen: existingReferences,
            review_candidates: createdOrQueuedReviews,
            sales_skus_seen: salesSkus,
            dry_run: args.dryRun,
          }));
        } catch (error) {
          sourceState.errors[url] = { error_message: error.message, occurred_at: nowIso() };
          console.log(JSON.stringify({ discovery: 'new_references', source: source.id, url, status: 'error', error: error.message }));
          processedPages += 1;
        } finally {
          sourceProcessedPages += 1;
          await page.close().catch(() => {});
        }
      }
    }

  if (!args.dryRun && writeBackRequired(config)) {
    const pendingReviewCandidates = Object.values(discoveryCache.review_candidates || {})
      .filter((candidate) => !candidate.write_back_success && reviewCandidateReadyForWriteBack(candidate));
    const reviewWriteBacks = await writeBackReviewCandidates({ config, baseDir, candidates: pendingReviewCandidates, debug: args.debug });
    markReviewWriteBackResults(discoveryCache, reviewWriteBacks);
  }

  state.last_finished_at = nowIso();
  state.last_success_at = nowIso();
  if (!args.dryRun) {
    writeJson(paths.newReferenceDiscoveryStateFile, state);
    writeJson(paths.discoveryCacheFile, discoveryCache);
  }
  console.log(JSON.stringify({
    discovery: 'new_references_summary',
    master_rows: master?.rowCount || 0,
    processed_pages: processedPages,
    review_cache: Object.keys(discoveryCache.review_candidates || {}).length,
    unposted_review_cache: Object.values(discoveryCache.review_candidates || {}).filter((candidate) => !candidate.write_back_success).length,
    dry_run: args.dryRun,
  }));
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
    discoveryCacheFile: resolveProjectPath(baseDir, config.discoveryCacheFile || 'opportunistic-discoveries.json'),
    newReferenceDiscoveryStateFile: resolveProjectPath(baseDir, config.newReferenceDiscoveryStateFile || 'new-reference-discovery-state.json'),
  };
  paths.resultLog = path.join(paths.logsDir, `results-${new Date().toISOString().slice(0, 10)}.jsonl`);

  fs.mkdirSync(paths.profileDir, { recursive: true });
  fs.mkdirSync(paths.imagesDir, { recursive: true });
  fs.mkdirSync(paths.logsDir, { recursive: true });

  const headless = args.authSetup ? false : args.headless === true ? true : args.headed ? false : config.headless !== false;
  const state = readJson(paths.stateFile, { products: {} });
  const discoveryCache = loadDiscoveryCache(paths.discoveryCacheFile);
  const newReferenceDiscoverySources = config.newReferenceDiscovery?.sources || defaultNewReferenceDiscoverySources();
  const newReferenceDiscoveryState = normalizeNewReferenceDiscoveryState(readJson(paths.newReferenceDiscoveryStateFile, {}), newReferenceDiscoverySources);
  const useConfigProducts = args.useConfigProducts || config.masterSource?.enabled === false;
  const master = useConfigProducts ? null : await fetchMasterProducts(config, baseDir, args.debug);
  if (!master && !useConfigProducts) {
    throw new Error('Master products are required for normal collector runs. Use --use-config-products only for explicit local tests.');
  }
  if (!args.statusJson && !args.dryRun) {
    await normalizeNotFoundProductUrlWriteBacks({ config, baseDir, state, master, debug: args.debug });
  }
  const products = selectProducts(config, state, args.refs, master?.products || null);
  const masterReferences = new Set((master?.products || config.products || []).map((product) => product.reference).filter(Boolean));

  if (args.statusJson) {
    console.log(JSON.stringify(buildStatusSummary(config, state, master, products, discoveryCache, newReferenceDiscoveryState)));
    return;
  }

  if (!args.discoverNewReferences && !args.backfillOfficialDescriptions && products.length === 0) {
    console.log('No pending products selected.');
    return;
  }

  if (!args.discoverNewReferences && !args.backfillOfficialDescriptions) {
    console.log(`Selected ${products.length} product(s)${master ? ` from master rows=${master.rowCount}` : ' from config'}.`);
  }

  if (args.dryRun && !args.discoverNewReferences && !args.backfillOfficialDescriptions) {
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

    if (args.backfillOfficialDescriptions) {
      await runOfficialDescriptionBackfill({ context, config, master, baseDir, args });
      return;
    }

    if (args.discoverNewReferences) {
      await runNewReferenceDiscovery({ context, config, paths, master, discoveryCache, baseDir, args });
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
              discovery_version: PRODUCT_URL_DISCOVERY_VERSION,
              method: 'local_state',
              url: product.productUrl,
              source_url: '',
              searched_queries: [],
              attempted_urls: [],
              acquired_at: nowIso(),
              error_message: '',
            }
          : await discoverProductPageUrl(context, product, config, args.debug, discoveryCache, masterReferences);
        const previous = state.products?.[product.reference] || {};
        const maxRetries = Number.isFinite(config.maxRetries) ? config.maxRetries : 3;
        const normalizedDiscoveryStatus = normalizeProductUrlStatus(discovery.status);
        const discoveryIsNotFound = normalizedDiscoveryStatus === 'not_found';
        const discoveryRetryCount = discovery.success || discoveryIsNotFound
          ? previous.retry_count || 0
          : (previous.retry_count || product.retry_count || 0) + 1;
        const discoveryStatusForState = discovery.success
          ? 'available'
          : discoveryIsNotFound
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
          const writeBackFailed = writeBackRequired(config) && discoveryResult.urlDiscovery?.writeBack?.success === false;
          const status = discovery.success
            ? previous.status || 'pending'
            : discoveryIsNotFound && !writeBackFailed
              ? 'not_found'
              : discoveryRetryCount < maxRetries
                ? 'retry'
                : 'error';
          state.products[product.reference] = {
            ...previous,
            status,
            retry_count: discoveryRetryCount,
            updated_at: nowIso(),
            last_attempt_at: nowIso(),
            last_error: discoveryResult.error || '',
            productUrl: product.productUrl || previous.productUrl || '',
            urlDiscovery: discoveryResult.urlDiscovery,
            images: previous.images || {},
            writeBack: previous.writeBack || null,
          };
          if (discoveryCache && writeBackRequired(config)) {
            const pendingReviewCandidates = Object.values(discoveryCache.review_candidates || {})
              .filter((candidate) => !candidate.write_back_success && reviewCandidateReadyForWriteBack(candidate));
            const reviewWriteBacks = await writeBackReviewCandidates({ config, baseDir, candidates: pendingReviewCandidates, debug: args.debug });
            markReviewWriteBackResults(discoveryCache, reviewWriteBacks);
          }
          writeJson(paths.stateFile, state);
          writeJson(paths.discoveryCacheFile, discoveryCache);
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
        discoveryCache,
        masterReferences,
      });
      try {
        await writeBackImageResults({ config, baseDir, product, result, debug: args.debug });
      } catch (error) {
        result.writeBack = { success: false, error_message: error.message, updated_at: nowIso() };
        result.error = result.error ? `${result.error} | writeback: ${error.message}` : `writeback: ${error.message}`;
        if (args.debug) console.log(`[writeback-failed] ${product.reference} ${error.message}`);
      }
      if (discoveryCache && result.reviewCandidates?.length) {
        for (const candidate of result.reviewCandidates) {
          cacheReviewCandidate(discoveryCache, candidate);
        }
      }
      if (discoveryCache && writeBackRequired(config)) {
        const pendingReviewCandidates = Object.values(discoveryCache.review_candidates || {})
          .filter((candidate) => !candidate.write_back_success && reviewCandidateReadyForWriteBack(candidate));
        const reviewWriteBacks = await writeBackReviewCandidates({ config, baseDir, candidates: pendingReviewCandidates, debug: args.debug });
        markReviewWriteBackResults(discoveryCache, reviewWriteBacks);
      }
      updateState(state, product, result, Number.isFinite(config.maxRetries) ? config.maxRetries : 3, config);
      writeJson(paths.stateFile, state);
      writeJson(paths.discoveryCacheFile, discoveryCache);
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
