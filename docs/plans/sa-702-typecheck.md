# Plan: Type-check every Node app

**Status**: Draft
**Zone**: yellow

## Goal

`lint.yml` type-checks every package that depends on TypeScript, and the `lint` gate waits for that job.

## Apps

Measured 22 Nov 2026 with `tsc --noEmit`. No errors.

| App | Errors |
| --- | --- |
| `apps/admin_web` | 0 |
| `apps/public_www` | 0 |
| `apps/training` | 0 |
| `backend/infrastructure` | 0 |

Each `tsconfig.json` includes the app sources. `noEmit` is already set on the three Next apps.

## Non-goals

No mypy, no coverage floor, and no OpenAPI lint. The existing OpenAPI lint job is unchanged.

## Files

The four `package.json` scripts, `.github/workflows/lint.yml`, and this plan.

## Invariants this change preserves

The `lint` job id and its display name stay `lint`. Node stays on the `setup-node` default.

## Done when

The `lint` gate lists `type-check`, and that job runs `npm run typecheck` in each app above.

## Rollback

Revert this pull request.

## Open questions

None.
