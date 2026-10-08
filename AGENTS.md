# Agent Operating Instructions

Applies to Cursor agents working in this repository.

## Bootstrap

1. Always-applied constraints are in `.cursor/rules/00-repository-core.mdc`. Path-scoped rules in `.cursor/rules/` attach for the area you edit. Read a scoped rule before editing its area when it is not already in context.
2. Procedures live in `.cursor/skills/*/SKILL.md`: `db-migration`, `admin-api-endpoint`, `admin-crud-screen`, `public-www-section`, and `verify-change`.
3. `.cursorrules` is a legacy pointer. Do not add rules there.

## Zones

Autonomy follows blast radius. The map is `docs/architecture/zones.md`.

- **Red.** Plan in chat and wait for explicit approval before any write. A human pairs on the change. Paths include database migrations and seed data, billing and invoice PDFs, auth and authorizers, CDK, deploy workflows, and PII tooling.
- **Yellow.** Write a short plan under `docs/plans/` from `docs/plans/_template.md`, add or update tests first, then implement. Paths include the rest of the backend, admin web source, and the Flutter app.
- **Green.** Implement and verify. Summarise intent in the pull request. Paths include the public website, the training site, docs, and test-only edits outside red paths.

The stricter zone wins when a change touches more than one. If scope grows into a stricter zone, stop and ask.

## Cursor Cloud

| Service | Path | Dev command | Port |
| --- | --- | --- | --- |
| Admin Web | `apps/admin_web/` | `npm run dev -- --webpack --port 3000` | 3000 |
| Public Website | `apps/public_www/` | `npm run dev -- --port 3001` | 3001 |
| Training Web | `apps/training/` | `npm run dev` | 3002 |
| Backend | `backend/` | `pytest tests/` | n/a |
| CDK | `backend/infrastructure/` | `npx tsc --noEmit` | n/a |

Lint: `ruff check backend/ tests/ --config=backend/pyproject.toml`; `npm run lint` in each app; `npm run lint` in `backend/infrastructure`.

Tests: `pytest tests/`; `npx vitest run` in each app; `npm run test:infra` in `backend/infrastructure`. Postgres integration tests run in CI with `TEST_DATABASE_URL`.

Before committing Python, run `pre-commit run ruff-format --all-files`.

Admin web dev and build need `--webpack` for SVGR. Admin sign-in needs `NEXT_PUBLIC_COGNITO_*`. Website QR needs `NEXT_PUBLIC_PUBLIC_SITE_BASE_URL` and `NEXT_PUBLIC_TRAINING_SITE_BASE_URL`. Contacts map needs `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

Public website local env minimum: `NEXT_PUBLIC_SITE_ORIGIN=http://localhost:3001` and `NEXT_PUBLIC_EMAIL=dev@example.com`. Training local env minimum: `NEXT_PUBLIC_SITE_ORIGIN=http://localhost:3002` and `NEXT_PUBLIC_PUBLIC_WWW_ORIGIN=http://localhost:3001`. Full setup is in `docs/architecture/setup.md`.

## Evidence

A change is done when the `verify-change` skill's checks pass and the pull request template is filled in. Hooks format edits and block destructive shell commands. CI remains the merge gate.

## Hooks

`.cursor/hooks.json` denies force-push, pushes to `main`, `git reset --hard`, `rm -rf` outside `/tmp`, destructive SQL, `cdk deploy`, and `aws delete-*`. It asks before `git commit --amend` and `alembic downgrade`. After an edit it formats Python with Ruff and web files with ESLint, and reports failures back. On stop it re-prompts when the local harness scripts fail.
