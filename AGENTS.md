# Agent Operating Instructions

Applies to any AI coding agent that works in this repository (including web
agents).

## Mandatory bootstrap step

1. Read `@.cursorrules` before any analysis, plan, command, or code edit.
2. Treat the rules in `.cursorrules` as mandatory for the full session.
3. Re-read `.cursorrules` immediately if it changes during the task.
4. If instructions conflict, use this precedence:
   system instructions > developer instructions > user instructions >
   `.cursorrules`.

## Headless, cloud, and IDE agent runtimes

Many agent runtimes (including Cursor Agent / Background Agent) **do not**
reliably inject the repository root `.cursorrules` file into the model context.
**Before your first repository tool call in a session**, read the file
`.cursorrules` at the repository root using your file-reading tool, unless the
full current contents of that file are already present in your context.

Cursor local chat can use `@.cursorrules`; that mention does not replace reading
the file when your runtime might omit it.

## Enforcement intent

Do not begin implementation work until `.cursorrules` has been loaded and
applied.
Do not perform implementation actions until explicit user approval is received
for the current task.
Treat all write operations as implementation actions, including file
create/edit/delete, dependency changes, migrations, generated artifacts, and
git write operations (`git add`, `git commit`, `git push`).
If implementation scope changes after approval, pause and request renewed
explicit user approval before continuing.

## Repository-enforced guardrail

The repository enforces a `.cursorrules` contract via
`scripts/validate-cursorrules.sh` (wired into pre-commit and CI lint checks).
This does not alter runtime prompt precedence, but it blocks merges when
mandatory `.cursorrules` integration anchors are removed or weakened.

## Cursor Cloud specific instructions

### Services overview

| Service | Path | Dev command | Port |
|---------|------|-------------|------|
| Admin Web (Next.js) | `apps/admin_web/` | `npm run dev -- --webpack --port 3000` | 3000 |
| Public Website (Next.js) | `apps/public_www/` | `npm run dev -- --port 3001` | 3001 |
| Training Web (Next.js) | `apps/training/` | `npm run dev` | 3002 |
| Backend (Python/Lambda) | `backend/` | Tests only (`pytest tests/`) | N/A |
| CDK Infrastructure (TS) | `backend/infrastructure/` | `npx tsc --noEmit` | N/A |

### Running lint

- **Python backend**: `ruff check backend/ tests/ --config=backend/pyproject.toml`
- **Admin web**: `cd apps/admin_web && npm run lint`
- **Public website**: `cd apps/public_www && npm run lint`
- **Training web**: `cd apps/training && npm run lint`
- **Pre-commit (all)**: `pre-commit run --all-files` (requires `pre-commit install` first)

### Running tests

- **Python backend**: `pytest tests/ -x` (926 tests, ~7s, no DB needed for unit tests)
- **Admin web**: `cd apps/admin_web && npx vitest run` (443 tests)
- **Public website**: `cd apps/public_www && npx vitest run` (739 tests)
- **Training web**: `cd apps/training && npx vitest run`
- **CDK infra**: `cd backend/infrastructure && npm run test:infra`

### Environment variables for dev servers

- **Admin web** requires Cognito env vars (`NEXT_PUBLIC_COGNITO_*`) for auth
  flows. Without them, the app renders but sign-in won't work.
- **Admin web** Website QR also needs `NEXT_PUBLIC_PUBLIC_SITE_BASE_URL` (www)
  and `NEXT_PUBLIC_TRAINING_SITE_BASE_URL` (training) for link previews.
- **Public website** requires `NEXT_PUBLIC_SITE_ORIGIN` and
  `NEXT_PUBLIC_EMAIL` at minimum. Create `apps/public_www/.env.local` with:
  ```
  NEXT_PUBLIC_SITE_ORIGIN=http://localhost:3001
  NEXT_PUBLIC_EMAIL=dev@example.com
  NEXT_PUBLIC_BUSINESS_NAME=Evolve Sprouts
  NEXT_PUBLIC_BUSINESS_ADDRESS=Hong Kong
  NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
  NEXT_PUBLIC_API_BASE_URL=/www
  ```
- **Training web** requires `NEXT_PUBLIC_SITE_ORIGIN` and
 `NEXT_PUBLIC_PUBLIC_WWW_ORIGIN` at minimum. Poll pages also need
 `NEXT_PUBLIC_TRAINING_API_KEY` (or `NEXT_PUBLIC_WWW_CRM_API_KEY`) for
 `PUT /www/v1/polls/{slug}/answers`. Create `apps/training/.env.local`
 with:
 ```
 NEXT_PUBLIC_SITE_ORIGIN=http://localhost:3002
 NEXT_PUBLIC_PUBLIC_WWW_ORIGIN=http://localhost:3001
 NEXT_PUBLIC_API_BASE_URL=/www
 NEXT_PUBLIC_TRAINING_API_KEY=<same public CRM API key as public_www>
 ```

### Non-obvious caveats

- Admin web uses `--webpack` flag for dev/build (required for SVGR support):
  `next dev --webpack` / `next build --webpack`.
- The backend has no running server locally; it is Lambda-based. Tests use
  `unittest.mock` and optional Postgres (`TEST_DATABASE_URL`) for integration cases.
- `backend/infrastructure` install is a normal `npm ci` (no postinstall
  patcher for bundled `aws-cdk-lib` dependencies).
- Python formatting must use `pre-commit run ruff-format --all-files` before
  committing any Python changes (per `.cursorrules`).
