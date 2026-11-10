import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, '../out/landing-pages-manifest.json');

const API_BASE_URL_ENV = 'NEXT_PUBLIC_API_BASE_URL';
const API_KEY_ENV = 'NEXT_PUBLIC_WWW_CRM_API_KEY';
const BUILD_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;

export function resolveCalendarProbeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    throw new Error(
      `${API_BASE_URL_ENV} must be an absolute http(s) URL so the calendar probe can fetch it.`,
    );
  }
  return trimmed;
}

export function buildCalendarUrl(baseUrl, slug) {
  const trimmed = resolveCalendarProbeBaseUrl(baseUrl);
  const search = new URLSearchParams({ slug });
  return `${trimmed}/v1/calendar/public?${search.toString()}`;
}

function parseHttpStatusFromProbeError(error) {
  if (!(error instanceof Error)) {
    return null;
  }
  const match = error.message.match(/^HTTP (\d{3}) for slug=/);
  if (!match) {
    return null;
  }
  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : null;
}

async function fetchWithTimeout(url, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'x-api-key': apiKey,
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeSlug(baseUrl, apiKey, slug) {
  const url = buildCalendarUrl(baseUrl, slug);
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, apiKey, BUILD_TIMEOUT_MS);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const httpError = new Error(
          `HTTP ${response.status} for slug=${slug} attempt=${attempt}: ${text.slice(0, 200)}`,
        );
        if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
          lastError = httpError;
          continue;
        }
        throw httpError;
      }
      return;
    } catch (error) {
      lastError = error;
      const httpStatus = parseHttpStatusFromProbeError(error);
      if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
        throw error;
      }
      if (attempt === MAX_ATTEMPTS) {
        if (httpStatus !== null && httpStatus >= 500) {
          throw error;
        }
        const isAbort = error instanceof Error && error.name === 'AbortError';
        const reason = isAbort ? 'timeout' : 'transport';
        throw new Error(
          `Calendar probe failed for slug=${slug} (${reason}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function main() {
  const apiKey = process.env[API_KEY_ENV]?.trim() ?? '';
  if (!apiKey) {
    console.error(`${API_KEY_ENV} must be set for landing page calendar validation.`);
    process.exit(1);
  }

  let baseUrl;
  try {
    baseUrl = resolveCalendarProbeBaseUrl(process.env[API_BASE_URL_ENV]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`Failed to read ${manifestPath}. Run next build first.`, error);
    process.exit(1);
  }

  const slugs = Array.isArray(manifest.slugs) ? manifest.slugs : [];
  if (slugs.length === 0) {
    console.warn('No landing page slugs in manifest; skipping calendar probes.');
    return;
  }

  return Promise.all(slugs.map((slug) => probeSlug(baseUrl, apiKey, slug))).then(
    () => {
      console.log(`Calendar reachability OK for ${slugs.length} landing page slug(s).`);
    },
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}

function isDirectExecution() {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  await main();
}
