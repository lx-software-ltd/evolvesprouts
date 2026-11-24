#!/usr/bin/env bash
ERRORS=0
if [ -z "$FIGMA_OAUTH_CLIENT_ID" ]; then
  echo '::error::FIGMA_OAUTH_CLIENT_ID secret is not set.'
  ERRORS=1
fi
if [ -z "$FIGMA_OAUTH_CLIENT_SECRET" ]; then
  echo '::error::FIGMA_OAUTH_CLIENT_SECRET secret is not set.'
  ERRORS=1
fi
if [ -z "$FIGMA_OAUTH_REFRESH_TOKEN" ]; then
  echo '::error::FIGMA_OAUTH_REFRESH_TOKEN secret is not set.'
  ERRORS=1
fi
if [ -z "$FIGMA_FILE_KEY" ]; then
  echo '::error::PUBLIC_WWW_FIGMA_FILE_KEY variable is not set.'
  ERRORS=1
fi
if [ "$ERRORS" -eq 1 ]; then exit 1; fi
echo 'All Figma credentials are present.'
