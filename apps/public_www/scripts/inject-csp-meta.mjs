import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const BUILD_OUTPUT_DIRECTORY = resolve('out');
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
// Cloudflare Web Analytics injects beacon.min.js from this host at the edge.
const CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN = 'https://static.cloudflareinsights.com';
// Beacon posts to this host (distinct from Turnstile / challenges.cloudflare.com).
const CLOUDFLARE_INSIGHTS_CONNECT_ORIGIN = 'https://cloudflareinsights.com';
const API_BASE_URL_ENV_NAME = 'NEXT_PUBLIC_API_BASE_URL';

// GTM may load Google Ads / conversion tags; hosts align with Google Tag Platform CSP guidance.
const GTM_SCRIPT_ORIGINS = [
  'https://www.googletagmanager.com',
  'https://googleads.g.doubleclick.net',
  'https://www.googleadservices.com',
];
const GTM_CONNECT_ORIGINS = [
  'https://www.google-analytics.com',
  'https://analytics.google.com',
  'https://region1.google-analytics.com',
  'https://stats.g.doubleclick.net',
  'https://www.google.com',
  'https://googleads.g.doubleclick.net',
];
const GTM_DETECT_MARKER = 'init-gtm.js';

const META_PIXEL_SCRIPT_ORIGINS = ['https://connect.facebook.net'];
const META_PIXEL_CONNECT_ORIGINS = ['https://www.facebook.com'];
const META_PIXEL_DETECT_MARKER = 'init-meta-pixel.js';
const STRIPE_SCRIPT_ORIGINS = ['https://js.stripe.com'];
const STRIPE_CONNECT_ORIGINS = [
  'https://api.stripe.com',
  'https://m.stripe.network',
  'https://r.stripe.com',
];
const STRIPE_FRAME_ORIGINS = ['https://js.stripe.com', 'https://hooks.stripe.com'];
const STRIPE_DETECT_MARKER = 'stripe-js';
const STRIPE_PUBLISHABLE_KEY_ENV_NAME = 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY';

const ADMIN_API_CONNECT_ORIGINS = resolveApiConnectOrigins({
  envName: API_BASE_URL_ENV_NAME,
  allowRelativePath: true,
});

function resolveApiConnectOrigins({ envName, allowRelativePath }) {
  const configuredBaseUrl = process.env[envName]?.trim() ?? '';
  if (configuredBaseUrl === '') {
    return [];
  }

  // Relative paths (for example "/api" or "/prod") are same-origin and covered by 'self'.
  if (allowRelativePath && configuredBaseUrl.startsWith('/')) {
    return [];
  }

  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(configuredBaseUrl);
  } catch {
    throw new Error(
      `${envName} must be an absolute URL or a relative path.`,
    );
  }

  const protocol = parsedBaseUrl.protocol.toLowerCase();
  const hostname = parsedBaseUrl.hostname.toLowerCase();
  const isLocalhostHttpOrigin = protocol === 'http:' && hostname === 'localhost';
  if (protocol !== 'https:' && !isLocalhostHttpOrigin) {
    throw new Error(
      `${envName} must use https, or http://localhost for local development.`,
    );
  }

  return [parsedBaseUrl.origin];
}

function buildCspDirectiveBase(hasGtm, hasMetaPixel, hasStripe) {
  const connectSources = [
    "'self'",
    ...ADMIN_API_CONNECT_ORIGINS,
    TURNSTILE_ORIGIN,
    CLOUDFLARE_INSIGHTS_CONNECT_ORIGIN,
  ];
  if (hasGtm) {
    connectSources.push(...GTM_CONNECT_ORIGINS);
  }
  if (hasMetaPixel) {
    connectSources.push(...META_PIXEL_CONNECT_ORIGINS);
  }
  if (hasStripe) {
    connectSources.push(...STRIPE_CONNECT_ORIGINS);
  }
  const dedupedConnectSources = [...new Set(connectSources)];
  const frameSources = ["'self'", TURNSTILE_ORIGIN];
  if (hasStripe) {
    frameSources.push(...STRIPE_FRAME_ORIGINS);
  }
  const dedupedFrameSources = [...new Set(frameSources)];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com data:",
    `connect-src ${dedupedConnectSources.join(' ')}`,
    `frame-src ${dedupedFrameSources.join(' ')}`,
    "form-action 'self' mailto:",
    "worker-src 'self' blob:",
  ];
}

const HEAD_OPENING_TAG_REGEX = /<head\b[^>]*>/i;
const EXISTING_CSP_META_REGEX =
  /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i;

function toSha256HashSource(value) {
  const digest = createHash('sha256').update(value, 'utf8').digest('base64');
  return `'sha256-${digest}'`;
}

function escapeHtmlAttribute(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function collectUniqueInlineBodies(values) {
  const seen = new Set();
  const orderedBodies = [];

  for (const body of values) {
    if (body.trim() === '' || seen.has(body)) {
      continue;
    }

    seen.add(body);
    orderedBodies.push(body);
  }

  return orderedBodies;
}

function collectInlineBodiesWithDom(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const inlineScriptBodies = collectUniqueInlineBodies(
    [...document.querySelectorAll('script:not([src])')].map(
      (element) => element.textContent ?? '',
    ),
  );
  const inlineStyleBodies = collectUniqueInlineBodies(
    [...document.querySelectorAll('style')].map(
      (element) => element.textContent ?? '',
    ),
  );
  const inlineStyleAttributeValues = collectUniqueInlineBodies(
    [...document.querySelectorAll('[style]')].map(
      (element) => element.getAttribute('style') ?? '',
    ),
  );

  dom.window.close();

  return {
    inlineScriptBodies,
    inlineStyleBodies,
    inlineStyleAttributeValues,
  };
}

function collectQueuedNextInlineScripts(inlineScriptBodies) {
  const queuedBodies = [];
  const seen = new Set();

  for (const scriptBody of inlineScriptBodies) {
    const pushCallIndex = scriptBody.indexOf('.push(');
    if (!scriptBody.includes('__next_s') || pushCallIndex < 0) {
      continue;
    }

    const payloadStartIndex = pushCallIndex + '.push('.length;
    const payloadEndIndex = scriptBody.lastIndexOf(')');
    if (payloadEndIndex <= payloadStartIndex) {
      continue;
    }

    const payloadRaw = scriptBody.slice(payloadStartIndex, payloadEndIndex);
    try {
      const payload = JSON.parse(payloadRaw);
      if (!Array.isArray(payload) || payload.length < 2) {
        continue;
      }

      const scriptSource = payload[0];
      const scriptProps = payload[1];
      if (
        scriptSource ||
        !scriptProps ||
        typeof scriptProps !== 'object' ||
        typeof scriptProps.children !== 'string'
      ) {
        continue;
      }

      const inlineChildren = scriptProps.children;
      if (inlineChildren.trim() === '' || seen.has(inlineChildren)) {
        continue;
      }

      seen.add(inlineChildren);
      queuedBodies.push(inlineChildren);
    } catch {
      // Ignore payloads that are not parseable JSON arrays.
    }
  }

  return queuedBodies;
}

function buildCspValue(html) {
  const {
    inlineScriptBodies,
    inlineStyleBodies,
    inlineStyleAttributeValues,
  } = collectInlineBodiesWithDom(html);
  const queuedInlineScriptBodies = collectQueuedNextInlineScripts(inlineScriptBodies);

  const scriptHashes = [
    ...new Set(
      [...inlineScriptBodies, ...queuedInlineScriptBodies].map(toSha256HashSource),
    ),
  ];
  const styleHashes = [...new Set(inlineStyleBodies.map(toSha256HashSource))];
  const styleAttributeHashes = [
    ...new Set(inlineStyleAttributeValues.map(toSha256HashSource)),
  ];

  const hasGtm = html.includes(GTM_DETECT_MARKER);
  const hasMetaPixel = html.includes(META_PIXEL_DETECT_MARKER);
  const hasStripe =
    html.includes(STRIPE_DETECT_MARKER) ||
    Boolean(process.env[STRIPE_PUBLISHABLE_KEY_ENV_NAME]?.trim());
  const gtmScriptOrigins = hasGtm ? GTM_SCRIPT_ORIGINS : [];
  const metaPixelScriptOrigins = hasMetaPixel ? META_PIXEL_SCRIPT_ORIGINS : [];
  const stripeScriptOrigins = hasStripe ? STRIPE_SCRIPT_ORIGINS : [];

  const scriptDirectiveSources = [
    "'self'",
    TURNSTILE_ORIGIN,
    CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN,
    ...gtmScriptOrigins,
    ...metaPixelScriptOrigins,
    ...stripeScriptOrigins,
    ...scriptHashes,
  ].join(' ');
  const styleDirectiveSources = [
    "'self'",
    ...(styleAttributeHashes.length > 0 ? ["'unsafe-hashes'"] : []),
    ...styleHashes,
    ...styleAttributeHashes,
  ].join(' ');

  const directives = [
    ...buildCspDirectiveBase(hasGtm, hasMetaPixel, hasStripe),
    `script-src ${scriptDirectiveSources}`,
    `style-src ${styleDirectiveSources}`,
  ];

  return {
    cspValue: directives.join('; '),
    scriptHashCount: scriptHashes.length,
    styleHashCount: styleHashes.length,
    styleAttributeHashCount: styleAttributeHashes.length,
  };
}

function applyCspMetaTag(html, cspValue) {
  const escapedCsp = escapeHtmlAttribute(cspValue);
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${escapedCsp}"/>`;

  if (EXISTING_CSP_META_REGEX.test(html)) {
    return html.replace(EXISTING_CSP_META_REGEX, metaTag);
  }

  const headMatch = html.match(HEAD_OPENING_TAG_REGEX);
  if (!headMatch || typeof headMatch.index !== 'number') {
    throw new Error('Unable to locate <head> tag for CSP injection.');
  }

  const insertionIndex = headMatch.index + headMatch[0].length;
  return `${html.slice(0, insertionIndex)}${metaTag}${html.slice(insertionIndex)}`;
}

async function collectHtmlFiles(directoryPath) {
  const htmlFiles = [];
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      htmlFiles.push(...(await collectHtmlFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      htmlFiles.push(entryPath);
    }
  }

  return htmlFiles;
}

async function main() {
  const outputDirectoryStats = await stat(BUILD_OUTPUT_DIRECTORY).catch(() => null);
  if (!outputDirectoryStats || !outputDirectoryStats.isDirectory()) {
    throw new Error(
      `Build output directory "${BUILD_OUTPUT_DIRECTORY}" not found. Run "npm run build" first.`,
    );
  }

  const htmlFiles = await collectHtmlFiles(BUILD_OUTPUT_DIRECTORY);
  if (htmlFiles.length === 0) {
    throw new Error(
      `No HTML files were found under "${BUILD_OUTPUT_DIRECTORY}". Cannot inject CSP.`,
    );
  }

  let modifiedFiles = 0;
  let totalScriptHashes = 0;
  let totalStyleHashes = 0;
  let totalStyleAttributeHashes = 0;
  let maxScriptHashesOnPage = 0;

  for (const htmlPath of htmlFiles) {
    const html = await readFile(htmlPath, 'utf8');
    const {
      cspValue,
      scriptHashCount,
      styleHashCount,
      styleAttributeHashCount,
    } = buildCspValue(html);
    const updatedHtml = applyCspMetaTag(html, cspValue);

    if (updatedHtml !== html) {
      await writeFile(htmlPath, updatedHtml, 'utf8');
      modifiedFiles += 1;
    }

    totalScriptHashes += scriptHashCount;
    totalStyleHashes += styleHashCount;
    totalStyleAttributeHashes += styleAttributeHashCount;
    if (scriptHashCount > maxScriptHashesOnPage) {
      maxScriptHashesOnPage = scriptHashCount;
    }
  }

  console.log(
    [
      `Injected CSP meta into ${modifiedFiles}/${htmlFiles.length} HTML files.`,
      `Total script hash entries: ${totalScriptHashes}.`,
      `Total style hash entries: ${totalStyleHashes}.`,
      `Total style attribute hash entries: ${totalStyleAttributeHashes}.`,
      `Max script hashes on a single page: ${maxScriptHashesOnPage}.`,
    ].join(' '),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
