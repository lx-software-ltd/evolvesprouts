# Public Website — Figma Design Pipeline

This document describes how the `public_www` application integrates with
Figma for design tokens, component scaffolding, and content management.

## Overview

Figma is the **source of truth for visual design**. Code owns
**composition, behavior, and content**. The pipeline extracts design
tokens from Figma, scaffolds component shells, and generates CSS custom
properties — all without overwriting hand-edited code.

```
Figma Design File
    │
    ├── figma:pull ─────→ figma/files/file.json
    │
    ├── figma:tokenize ─→ figma/token-studio/global.json
    │                      (colors, typography, effects from published
    │                       styles + direct node values)
    │
    ├── figma:build:studio → shared/styles/generated/figma-tokens.css
    │                         (CSS custom properties)
    │
    ├── figma:scaffold ──→ src/components/sections/<name>.tsx (new only)
    │                       src/content/*.json (new keys only)
    │
    └── figma:specs ─────→ figma/design-specs/<name>.json
                            (structured design data for cloud agents)
```

## Key principles

1. **Idempotent syncs** — Generated design tokens (`global.json`,
   `figma-tokens.css`) are overwritten on each sync. Component files
   and content JSON keys are **never overwritten** once they exist.

2. **Figma for design, code for behavior** — Figma defines what things
   look like (colors, fonts, shadows). Code defines how things work
   (interactivity, dynamic data, page composition).

3. **Externalized content** — All visible text lives in language JSON
   files (`src/content/en.json`, `zh-CN.json`, `zh-HK.json`).
   Changing copy = editing a JSON file.

4. **Single responsive components** — Each component handles both
   desktop and mobile via CSS breakpoints. Figma may have separate
   Desktop/Mobile layers; the code uses responsive Tailwind classes.

## Directory structure

```
apps/public_www/
├── figma/
│   ├── files/                    # Raw Figma API payloads (gitignored)
│   │   └── file.json
│   ├── token-studio/             # Token Studio format tokens (tracked)
│   │   ├── $metadata.json
│   │   ├── $themes.json
│   │   ├── global.json           # ← overwritten on each sync
│   │   ├── semantic.json         # ← hand-edited, preserved
│   │   └── component.json        # ← hand-edited, preserved
│   ├── design-specs/             # Structured design data (tracked)
│   │   └── <section>.json        # ← overwritten on each sync
│   └── README.md
├── scripts/figma/
│   ├── pull-figma-tokens.mjs     # Fetch Figma file via OAuth2 API
│   ├── figma-to-token-studio.mjs # Extract tokens from file.json
│   ├── build-from-token-studio.mjs # Generate CSS from tokens
│   ├── scaffold-components.mjs   # Scaffold new section components
│   ├── extract-design-specs.mjs  # Extract design specs for cloud agents
│   ├── generate-refresh-token.mjs # OAuth refresh token generator
│   └── launch-figma-mcp.mjs     # MCP server launcher (OAuth2)
├── src/
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── layout.tsx        # Locale layout (lang/dir)
│   │   │   └── page.tsx          # Page composition
│   │   ├── globals.css
│   │   ├── layout.tsx            # Root layout
│   │   └── page.tsx              # Root redirect to /en
│   ├── components/sections/      # Section components (hand-edited)
│   │   ├── navbar.tsx
│   │   ├── hero-banner.tsx
│   │   ├── my-best-auntie-overview.tsx
│   │   ├── resources.tsx
│   │   ├── course-highlights.tsx
│   │   ├── testimonials.tsx
│   │   ├── sprouts-squad-community.tsx
│   │   └── footer.tsx
│   └── content/                  # i18n content (hand-edited)
│       ├── en.json
│       ├── zh-CN.json
│       ├── zh-HK.json
│       └── index.ts              # Type-safe content loader
```

## What gets overwritten vs preserved

| File | Sync behavior |
|------|--------------|
| `figma/token-studio/global.json` | **Overwritten** — always from Figma |
| `figma/token-studio/semantic.json` | **Preserved** — hand-curated aliases |
| `figma/token-studio/component.json` | **Preserved** — hand-curated |
| `shared/styles/generated/figma-tokens.css` | **Overwritten** — always from tokens (shared with training) |
| `figma/design-specs/*.json` | **Overwritten** — always from Figma |
| `src/components/sections/*.tsx` | **Preserved** — scaffolded once, then owned by developer |
| `src/content/*.json` | **Preserved** — new keys appended, existing keys untouched |
| `src/app/[locale]/page.tsx` | **Never touched** — always hand-edited |

## npm scripts

| Command | Description |
|---------|-------------|
| `figma:auth` | Generate OAuth refresh token (interactive) |
| `figma:pull` | Pull Figma file data via OAuth2 API |
| `figma:tokenize` | Extract design tokens → Token Studio JSON |
| `figma:build:studio` | Build CSS custom properties from tokens |
| `figma:scaffold` | Scaffold new section components (idempotent) |
| `figma:specs` | Extract design specs for cloud agents |
| `figma:studio-sync` | pull → tokenize → build |
| `figma:full-sync` | pull → tokenize → build → scaffold → specs |
| `build` | build:studio → next build |

## Token extraction

The tokenizer (`figma-to-token-studio.mjs`) extracts from two sources:

1. **Published Figma styles** (preferred) — Color styles, text styles,
   effect styles. These produce clean tokens named from the style name.

2. **Direct node values** (fallback) — Fill colors, text properties,
   and effects from FRAME, RECTANGLE, ELLIPSE, TEXT, COMPONENT, and
   INSTANCE nodes. VECTOR/LINE/BOOLEAN nodes are skipped to avoid
   icon noise. Tokens are named from the node name.

Published styles always override direct values. As you create published
styles in Figma, they automatically replace the direct-value tokens.

### Scoping

Set `FIGMA_TOKEN_ROOT_NODE` to a frame name or node ID to scope
extraction. This prevents picking up styles from imported libraries
(e.g. Material Design kits) that live elsewhere in the file.

## Component scaffolding

The scaffold generator (`scaffold-components.mjs`) reads the Figma
frame's direct children and creates a component file for each one.

**Idempotent behavior:**
- If the component file already exists → **skip** (never overwrite)
- If the component file is new → create with typed content props
- For content JSON files → append new section keys, preserve existing

**Usage:**
```bash
FIGMA_TOKEN_ROOT_NODE=Desktop npm run figma:scaffold
```

## Content / i18n

Three locales are supported: English (`en`), Chinese Simplified
(`zh-CN`), and Chinese Traditional (`zh-HK`).

Content is loaded via `getContent(locale)` from `src/content/index.ts`.
Types are automatically derived from `en.json` (source of truth).

To change text:
1. Edit the relevant key in `src/content/en.json`
2. Update the same key in `zh-CN.json` and `zh-HK.json`

To add a new section:
1. Add a key in all three JSON files
2. Export a type from `src/content/index.ts`
3. Create a component in `src/components/sections/`
4. Add it to the page in `src/app/[locale]/page.tsx`

## Page composition

Pages are composed in `src/app/[locale]/page.tsx` by importing and
arranging section components:

```tsx
import { Navbar } from '@/components/sections/navbar';
import { HeroBanner } from '@/components/sections/hero-banner';

export default async function HomePage({ params }) {
  const content = getContent(locale);
  return (
    <>
      <Navbar content={content.navbar} />
      <main>
        <HeroBanner content={content.hero} />
        {/* Add, remove, or reorder sections here */}
      </main>
    </>
  );
}
```

## GitHub Actions

### Figma Token Studio Sync (`figma-token-studio-sync.yml`)

Runs: on push to relevant paths, or manually.

Pipeline: `pull → tokenize → build → scaffold → commit`

Commits only if tokens, components, or content keys changed.

### Deploy Public Website (`deploy-public-www-staging.yml`)

Runs: on push to main affecting `apps/public_www/`.

Pipeline: `build (includes figma:build:studio) → deploy`

`figma:pull` and `figma:tokenize` run in the dedicated
`figma-token-studio-sync.yml` workflow, which commits token updates to git.
The deploy workflow consumes committed tokens and does not call the Figma API.

## Implementing components via Cursor cloud agents

Cloud agents cannot use the MCP server (it requires a local process)
and `figma/files/file.json` is gitignored. Instead, the pipeline
generates committed **design spec** files that any agent can read.

### Design specs

`figma/design-specs/<section>.json` contains the structured visual
properties for each section: colors, fonts, layout, dimensions,
effects, and text content — extracted directly from the Figma node
tree.

These files are **overwritten on each sync** (they are generated,
not hand-edited).

### Cloud agent workflow

To implement a section component, open a Cursor cloud agent task
with a prompt like:

> Implement the hero-banner component at
> `apps/public_www/src/components/sections/hero-banner.tsx`.
> Read the design spec at
> `apps/public_www/figma/design-specs/banner.json` for the visual
> design (colors, fonts, layout, dimensions). Read
> `apps/public_www/src/content/en.json` (hero section) for text
> content. Use CSS custom properties from
> `shared/styles/generated/figma-tokens.css` where
> available, and Tailwind for layout. Make it responsive
> (mobile-first).

The agent reads the committed spec file, sees the exact design
properties from Figma, and implements the component without
needing Figma API access.

## Cursor MCP integration

The `.cursor/mcp.json` configures the Framelink Figma MCP server using
OAuth2. When you paste a Figma URL in Cursor, the MCP server fetches
the design data so you can implement component details from the design.

Required env vars: `FIGMA_OAUTH_CLIENT_ID`, `FIGMA_OAUTH_CLIENT_SECRET`,
`FIGMA_OAUTH_REFRESH_TOKEN`.
