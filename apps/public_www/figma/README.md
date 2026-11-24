# Figma token pipeline for `public_www`

This directory stores input and output files used by the Figma design
token pipeline. For the full architecture documentation, see
[docs/architecture/public-www-figma-pipeline.md](../../../docs/architecture/public-www-figma-pipeline.md).

## Directory structure

- `files/` — Raw Figma API payloads (gitignored JSON files)
- `design-specs/` — Structured design data per section (tracked in git, for cloud agents)
- `token-studio/` — Token Studio design tokens (tracked in git)
  - `$metadata.json` — token set ordering
  - `$themes.json` — theme definitions (Light, Dark)
  - `global.json` — primitive tokens (overwritten on each sync)
  - `semantic.json` — semantic aliases (hand-edited, preserved)
  - `component.json` — component tokens (hand-edited, preserved)

## Quick start

```bash
# Full pipeline: pull Figma data → extract tokens → build CSS → scaffold components
FIGMA_TOKEN_ROOT_NODE=Desktop npm run figma:full-sync

# Just tokens (no scaffolding)
npm run figma:studio-sync

# Just scaffold new components from existing Figma data
FIGMA_TOKEN_ROOT_NODE=Desktop npm run figma:scaffold
```

## Scripts

| Command | Description |
|---------|-------------|
| `figma:auth` | Generate OAuth refresh token (interactive) |
| `figma:pull` | Pull Figma file data via OAuth2 API |
| `figma:tokenize` | Extract tokens → Token Studio JSON |
| `figma:build:studio` | Build CSS from Token Studio tokens |
| `figma:scaffold` | Scaffold new section components (idempotent) |
| `figma:specs` | Extract design specs for cloud agents |
| `figma:studio-sync` | pull → tokenize → build |
| `figma:full-sync` | pull → tokenize → build → scaffold → specs |

## Authentication

For API scripts (`figma:pull`, `figma:studio-sync`, `figma:full-sync`):

```bash
FIGMA_OAUTH_CLIENT_ID=your-client-id
FIGMA_OAUTH_CLIENT_SECRET=your-client-secret
FIGMA_OAUTH_REFRESH_TOKEN=your-refresh-token
FIGMA_FILE_KEY=your-figma-file-key
```

For MCP (Cursor integration), the same OAuth2 credentials are used.

## Scoping extraction

Set `FIGMA_TOKEN_ROOT_NODE` to a frame name or node ID to extract
tokens and scaffold components from a specific Figma frame only:

```bash
FIGMA_TOKEN_ROOT_NODE=Desktop npm run figma:tokenize
```

## Generating a Figma OAuth refresh token

### Option A — GitHub Actions workflow (recommended)

1. Construct the authorization URL (see workflow summary for a ready-made URL).
2. Open it in your browser and click **Allow**.
3. Copy the `code` from the redirect URL.
4. Trigger the **Figma Generate OAuth Refresh Token** workflow with the code.
5. The workflow prints the refresh token in the run summary.

### Option B — Local script

```bash
FIGMA_OAUTH_CLIENT_ID=xxx FIGMA_OAUTH_CLIENT_SECRET=yyy npm run figma:auth
```

Follow the prompts to authorize and receive the refresh token.
