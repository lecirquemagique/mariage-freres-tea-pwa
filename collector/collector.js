#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_CONFIG = 'config.json';
const IMAGE_TYPES = ['tea', 'liqueur'];
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

function normalizeUrl(raw, baseUrl) {
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return '';
  }
}

function isProbablyImageUrl(url) {
  return /\.(avif|webp|png|jpe?g|gif)(?:[?#]|$)/i.test(url || '');
}

function classifyCandidate(candidate, product, imageType) {
  const reference = String(product.reference || '').toLowerCase();
  const name = String(product.name || '').toLowerCase();
  const hay = [
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

  let score = 0;
  let reject = 0;

  if (hay.includes(reference)) score += 4;
  if (name && hay.includes(name)) score += 2;
  if (hay.includes('media/catalog/product')) score += 4;
  if (hay.includes('/cache/')) score += 1;
  if ((candidate.width || 0) >= 180 && (candidate.height || 0) >= 180) score += 2;
  if ((candidate.naturalWidth || 0) >= 180 && (candidate.naturalHeight || 0) >= 180) score += 2;

  if (imageType === 'liqueur') {
    if (/liqueur|liquor|liquore/.test(hay)) score += 10;
    if (/color_liqueur|liqueur/.test(hay)) score += 8;
  } else {
    if (/liqueur|liquor|liquore|color_liqueur/.test(hay)) reject += 8;
    if (/thes-au-poids|tea-by-the-weight|te-al-peso/.test(hay)) score += 2;
    if (/t\d{3,5}(-\d+p)?\.(jpe?g|png|webp|avif)/.test(hay)) score += 5;
  }

  if (/logo|payment|paiement|livraison|delivery|shipping|secure|sprite|icon|favicon|jardin/.test(hay)) reject += 10;
  if ((candidate.width || 0) > 0 && (candidate.width || 0) < 80) reject += 4;
  if ((candidate.height || 0) > 0 && (candidate.height || 0) < 80) reject += 4;

  return score - reject;
}

function pickCandidate(candidates, product, imageType) {
  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score: classifyCandidate(candidate, product, imageType),
    }))
    .filter((candidate) => candidate.url && candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0] || null;
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
  const fileName = `${sanitizeReference(product.reference)}_${imageType}${ext}`;
  const filePath = path.join(baseDir, fileName);
  fs.mkdirSync(baseDir, { recursive: true });
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

async function processProduct({ context, product, config, paths, debug }) {
  const page = await context.newPage();
  const pageUrl = product.productUrl;
  const cdp = await createCdpNetworkCapture(page, debug);
  const startedAt = Date.now();
  const result = { reference: product.reference, pageUrl, images: {}, successCount: 0 };

  try {
    if (debug) console.log(`[open] ${product.reference} ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 90000 });
    await page.waitForLoadState('networkidle', { timeout: config.networkIdleTimeoutMs || 45000 }).catch(() => {});
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

    fs.writeFileSync(
      path.join(paths.logsDir, `${product.reference}-candidates-${startedAt}.json`),
      JSON.stringify({ product, title, domCandidates, cacheCandidates, networkCandidates }, null, 2)
    );

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
    await page.close().catch(() => {});
  }
}

function selectProducts(config, state, refs) {
  const maxRetries = Number.isFinite(config.maxRetries) ? config.maxRetries : 3;
  const merged = (config.products || []).map((product) => ({ ...product, ...(state.products?.[product.reference] || {}) }));
  const filtered = refs?.length
    ? merged.filter((product) => refs.includes(product.reference))
    : merged.filter((product) => {
        const status = product.status || 'pending';
        const retryCount = product.retry_count || 0;
        if (status === 'complete') return false;
        if (status === 'error' && retryCount >= maxRetries) return false;
        return ['pending', 'partial', 'retry', 'error'].includes(status);
      });
  return filtered.slice(0, refs?.length ? refs.length : config.maxPerRun || 5);
}

function updateState(state, product, result, maxRetries) {
  state.products = state.products || {};
  const previous = state.products[product.reference] || {};
  const retryCount = result.successCount === 2 ? previous.retry_count || 0 : (previous.retry_count || product.retry_count || 0) + 1;
  let status = 'error';
  if (result.successCount === 2) status = 'complete';
  else if (result.successCount === 1) status = 'partial';
  else if (retryCount < maxRetries) status = 'retry';

  state.products[product.reference] = {
    status,
    retry_count: retryCount,
    updated_at: nowIso(),
    last_error: result.error || '',
    images: result.images,
  };
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

async function runAuthSetup({ context, products, config, debug }) {
  const page = await context.newPage();
  const firstUrl = products[0]?.productUrl || 'https://www.mariagefreres.com/fr/';
  console.log(`Opening ${firstUrl}`);
  await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs || 90000 }).catch((error) => {
    console.log(`Initial navigation warning: ${error.message}`);
  });
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
  await page.close().catch(() => {});
}

async function main() {
  const args = parseArgs(process.argv);
  const baseDir = process.cwd();
  const configPath = resolveProjectPath(baseDir, args.config);
  const fallbackConfigPath = path.join(baseDir, 'collector', 'config.example.json');
  const config = readJson(configPath, readJson(fallbackConfigPath));
  if (!config) throw new Error(`Config not found: ${configPath}`);

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
  const products = selectProducts(config, state, args.refs);

  if (products.length === 0) {
    console.log('No pending products selected.');
    return;
  }

  const launchOptions = {
    headless,
    viewport: { width: 1440, height: 1200 },
    locale: 'fr-FR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151 Safari/537.36',
  };

  if (process.env.MF_COLLECTOR_CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.MF_COLLECTOR_CHROMIUM_PATH;
  } else {
    const browserChannel = args.browserChannel || config.browserChannel || process.env.MF_COLLECTOR_BROWSER_CHANNEL || '';
    if (browserChannel) launchOptions.channel = browserChannel;
  }

  const context = await chromium.launchPersistentContext(paths.profileDir, launchOptions);
  try {
    if (args.authSetup) {
      await runAuthSetup({ context, products, config, debug: args.debug });
      return;
    }

    for (let i = 0; i < products.length; i += 1) {
      const product = products[i];
      const result = await processProduct({ context, product, config, paths, debug: args.debug });
      updateState(state, product, result, Number.isFinite(config.maxRetries) ? config.maxRetries : 3);
      writeJson(paths.stateFile, state);
      console.log(`${product.reference}: ${state.products[product.reference].status}`);

      if (i < products.length - 1) {
        const waitMs = randomDelay(config.pageDelayMs);
        if (args.debug) console.log(`[delay] ${waitMs}ms`);
        await sleep(waitMs);
      }
    }
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
