# Plan: Clear Dependabot deepmerge GHSA-gcqx-w48m-w2h4

**Status**: Done
**Zone**: green (admin web package manifest and lockfile; no screen behavior)

## Goal

Stop the Dependabot security job for `deepmerge` in `/apps/admin_web` from failing with `security_update_not_found`.

## Non-goals

- Do not change SVG optimization or admin screens.
- Do not replace `@svgr/webpack`.

## Files

- `apps/admin_web/package.json` and lockfile: override `deepmerge` to `4.1.2`.
- `.github/dependabot.yml`: ignore `deepmerge` versions `>= 4.2.0` so a later version update does not re-enter the advisory.

## Invariants this change preserves

- `@svgr/plugin-svgo` still resolves a `deepmerge` module. Its published build does not call it.
- Admin SVG loading through `@svgr/webpack` is unchanged.

## Done when

- `npm ls deepmerge` in `apps/admin_web` reports `4.1.2`.
- `npm ci` leaves `apps/admin_web/package-lock.json` unchanged.
- Loading `@svgr/plugin-svgo` still optimizes an SVG.

## Rollback

Revert the commit.

## Open questions

None. GHSA-gcqx-w48m-w2h4 has no patched release. 4.1.2 is the last version outside `>= 4.2.0 <= 4.3.1`.
