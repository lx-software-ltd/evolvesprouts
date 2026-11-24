#!/usr/bin/env bash
{
  echo '## Figma Token Studio Sync'
  echo ''

  if [ "$HAS_CHANGES" = "true" ]; then
    echo '### Status: Tokens updated'
    echo ''
    echo 'New design tokens were extracted from Figma and committed.'
    echo ''
    echo '| Detail | Value |'
    echo '|--------|-------|'
    echo "| Branch | \`${GITHUB_REF_NAME}\` |"
    echo "| Commit | \`$(git rev-parse --short HEAD)\` |"
    echo "| Figma file key | \`${FIGMA_FILE_KEY}\` |"
  else
    echo '### Status: No changes'
    echo ''
    echo 'Figma tokens are already up to date — nothing to commit.'
  fi

  echo ''
  echo '---'
  echo ''
  echo '**Files checked:**'
  echo '- `apps/public_www/figma/token-studio/global.json`'
  echo '- `apps/public_www/figma/token-studio/semantic.json`'
  echo '- `apps/public_www/figma/token-studio/component.json`'
  echo '- `shared/styles/generated/figma-tokens.css`'
  echo '- `apps/public_www/src/components/sections/*.tsx` (new only)'
  echo '- `apps/public_www/src/content/*.json` (new keys only)'
} >> "$GITHUB_STEP_SUMMARY"
