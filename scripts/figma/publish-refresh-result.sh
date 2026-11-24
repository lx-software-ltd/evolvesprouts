#!/usr/bin/env bash
PORT="${CALLBACK_PORT:-3845}"
REDIRECT_URI="http://localhost:${PORT}/callback"
ENCODED_REDIRECT=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${REDIRECT_URI}', safe=''))")
AUTH_URL="https://www.figma.com/oauth?client_id=${CLIENT_ID}&redirect_uri=${ENCODED_REDIRECT}&scope=file_content:read&state=$(openssl rand -hex 16)&response_type=code"

{
  echo '## Figma OAuth Refresh Token'
  echo ''

  if [ "$EXCHANGE_OK" = "true" ]; then
    echo '### Status: Success'
    echo ''
    echo '| Detail | Value |'
    echo '|--------|-------|'
    echo "| Figma user ID | \`${USER_ID:-n/a}\` |"
    echo "| Access token expires in | ${EXPIRES_IN:-?}s |"
    echo ''
    echo '### Refresh Token'
    echo ''
    echo 'Copy this value and add it as a repository secret named'
    echo '\`FIGMA_OAUTH_REFRESH_TOKEN\` under **Settings > Secrets and'
    echo 'variables > Actions**:'
    echo ''
    echo "\`\`\`"
    echo "${REFRESH_TOKEN}"
    echo "\`\`\`"
    echo ''
    echo '> **Note:** Delete this workflow run after copying the token'
    echo '> to avoid leaving it visible in the summary.'
  else
    echo '### Status: Failed'
    echo ''
    echo "Error: \`${ERROR_DETAIL:-unknown}\`"
    echo ''
    echo '### Debugging checklist'
    echo ''
    echo '1. **Callback URL match** — verify the Figma app callback URL is'
    echo "   exactly \`${REDIRECT_URI}\` (no trailing slash, no https)."
    echo '2. **Code copied correctly** — copy only the value between'
    echo '   \`?code=\` and \`&state=\` from the browser address bar.'
    echo '3. **Code not reused** — each code can only be exchanged once.'
    echo '   Re-open the authorization URL below to get a fresh code.'
    echo '4. **Code not expired** — authorize and trigger the workflow'
    echo '   within a few minutes.'
    echo ''
    echo '### How to retry'
    echo ''
    echo '1. Open the authorization URL below in your browser.'
    echo '2. Click **Allow** on the Figma page.'
    echo "3. Figma redirects to \`${REDIRECT_URI}?code=XXXXX&state=...\`"
    echo '   The page will not load — that is expected.'
    echo '4. Copy the \`code\` value from the address bar'
    echo '   (between \`?code=\` and \`&state=\`).'
    echo '5. Go to **Actions > Figma Generate OAuth Refresh Token > Run workflow**,'
    echo '   paste the code, and click **Run workflow**.'
  fi

  echo ''
  echo '---'
  echo ''
  echo '### Authorization URL'
  echo ''
  echo 'Open this in your browser to authorize (or re-authorize):'
  echo ''
  echo "\`\`\`"
  echo "${AUTH_URL}"
  echo "\`\`\`"
} >> "$GITHUB_STEP_SUMMARY"
