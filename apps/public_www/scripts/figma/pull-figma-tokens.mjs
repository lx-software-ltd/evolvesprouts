import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..', '..');
const FIGMA_FILES_DIR = path.join(APP_ROOT, 'figma', 'files');
const DEFAULT_FIGMA_OAUTH_TOKEN_URL =
  'https://api.figma.com/v1/oauth/token';

function getEnv(name) {
  return process.env[name]?.trim() ?? '';
}

async function ensureDirectory(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, data) {
  // Callers pass a fixed path under figma/files. The body is the Figma
  // document this operator script is saving.
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(filePath, content, 'utf8'); // lgtm[js/http-to-file-access]
}

async function ensureJsonIfMissing(filePath, fallback) {
  try {
    await readFile(filePath, 'utf8');
  } catch (_error) {
    await writeJson(filePath, fallback);
  }
}

async function fetchFigmaJson(endpoint, accessToken) {
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    const snippet = responseText.slice(0, 500);
    throw new Error(
      `Figma request failed (${response.status}) at ${endpoint}: ${snippet}`,
    );
  }

  return response.json();
}

function getMissingOAuthEnvVars(config) {
  return Object.entries(config)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

async function fetchOAuthAccessToken({
  tokenUrl,
  clientId,
  clientSecret,
  refreshToken,
}) {
  const tokenBody = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenBody.toString(),
  });

  const responseText = await response.text();
  const snippet = responseText.slice(0, 500);
  if (!response.ok) {
    throw new Error(
      `Figma OAuth token request failed (${response.status}) at ${tokenUrl}: ${snippet}`,
    );
  }

  let responseJson = {};
  try {
    responseJson = JSON.parse(responseText);
  } catch (_error) {
    throw new Error(
      `Figma OAuth token response is not valid JSON: ${snippet}`,
    );
  }

  const accessToken = responseJson.access_token?.trim?.() ?? '';
  if (!accessToken) {
    throw new Error(
      `Figma OAuth token response is missing access_token: ${snippet}`,
    );
  }

  return accessToken;
}

async function resolveFigmaAccessToken() {
  const directAccessToken = getEnv('FIGMA_OAUTH_ACCESS_TOKEN');
  if (directAccessToken) {
    return directAccessToken;
  }

  const oauthConfig = {
    FIGMA_OAUTH_CLIENT_ID: getEnv('FIGMA_OAUTH_CLIENT_ID'),
    FIGMA_OAUTH_CLIENT_SECRET: getEnv('FIGMA_OAUTH_CLIENT_SECRET'),
    FIGMA_OAUTH_REFRESH_TOKEN: getEnv('FIGMA_OAUTH_REFRESH_TOKEN'),
  };
  const configuredCount = Object.values(oauthConfig).filter(Boolean).length;
  if (configuredCount === 0) {
    return '';
  }

  if (configuredCount < Object.keys(oauthConfig).length) {
    const missingNames = getMissingOAuthEnvVars(oauthConfig);
    throw new Error(
      `Incomplete Figma OAuth configuration. Missing: ${missingNames.join(', ')}`,
    );
  }

  const tokenUrl =
    getEnv('FIGMA_OAUTH_TOKEN_URL') || DEFAULT_FIGMA_OAUTH_TOKEN_URL;
  return fetchOAuthAccessToken({
    tokenUrl,
    clientId: oauthConfig.FIGMA_OAUTH_CLIENT_ID,
    clientSecret: oauthConfig.FIGMA_OAUTH_CLIENT_SECRET,
    refreshToken: oauthConfig.FIGMA_OAUTH_REFRESH_TOKEN,
  });
}

async function main() {
  await ensureDirectory(FIGMA_FILES_DIR);

  const accessToken = await resolveFigmaAccessToken();
  const fileKey = getEnv('FIGMA_FILE_KEY');
  const fileInfoPath = path.join(FIGMA_FILES_DIR, 'file.json');
  const variablesPath = path.join(FIGMA_FILES_DIR, 'variables.local.json');

  if (!accessToken || !fileKey) {
    console.log(
      'Skipping Figma pull: set FIGMA_FILE_KEY and OAuth env vars.',
    );
    await ensureJsonIfMissing(fileInfoPath, {
      meta: {
        source: 'placeholder',
      },
    });
    await ensureJsonIfMissing(variablesPath, {
      meta: {
        variableCollections: {},
        variables: {},
      },
    });
    return;
  }

  const baseEndpoint = `https://api.figma.com/v1/files/${fileKey}`;
  const fileEndpoint = baseEndpoint;
  const variablesEndpoint = `${baseEndpoint}/variables/local`;

  const fileJson = await fetchFigmaJson(fileEndpoint, accessToken);
  await writeJson(fileInfoPath, fileJson);
  console.log('Pulled Figma file metadata into figma/files/.');

  // The variables endpoint requires the file_variables:read OAuth scope.
  // If the token lacks this scope, log a warning and write a placeholder
  // so the build can still proceed with file metadata alone.
  try {
    const variablesJson = await fetchFigmaJson(
      variablesEndpoint,
      accessToken,
    );
    await writeJson(variablesPath, variablesJson);
    console.log('Pulled Figma local variables into figma/files/.');
  } catch (error) {
    const isScopeError =
      error.message?.includes('scope') ||
      error.message?.includes('403');
    if (isScopeError) {
      console.warn(
        'Warning: could not fetch variables (requires file_variables:read scope).',
      );
      console.warn(
        'Skipping variables — build will proceed with file metadata and MDM exports only.',
      );
      await ensureJsonIfMissing(variablesPath, {
        meta: {
          variableCollections: {},
          variables: {},
        },
      });
    } else {
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
