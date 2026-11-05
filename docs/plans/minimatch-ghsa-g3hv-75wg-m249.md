# Plan: Clear Dependabot minimatch GHSA-g3hv-75wg-m249

**Status**: Done
**Zone**: green for training lockfile; red for CDK lockfile and the bundled-dep patcher

## Goal

Stop Dependabot Updates from failing on `minimatch` security jobs in `/apps/training` and `/backend/infrastructure`.

## Non-goals

- Do not bump ESLint's `minimatch` 3.x to 11.x (different API).
- Do not change CDK stacks, IAM, or deploy workflows.

## Files

- `apps/training/package.json` and lockfile: override `minimatch@10` to `11.0.4`.
- `backend/infrastructure/package.json` and lockfile: same override for typescript-eslint; restore a minimatch-only postinstall patcher for the `aws-cdk-lib` bundled copy.
- `.github/dependabot.yml`: remove the `minimatch` ignore that now fails the job as `all_versions_ignored`.
- `apps/admin_web` and `apps/public_www`: same `minimatch@10` override so the next solo security job does not fail.

## Invariants this change preserves

- ESLint still resolves `minimatch` 3.1.5.
- CDK construct code is unchanged.
- Training and admin/public tests still run.

## Done when

- Lockfiles contain no unbundled `minimatch` 10.x.
- `npm run lint` and the area tests pass.
- Check Lockfiles `npm ci` leaves the lockfiles unchanged.

## Rollback

Revert the commit.

## Open questions

None. The user asked to clear the failing Dependabot updates.
