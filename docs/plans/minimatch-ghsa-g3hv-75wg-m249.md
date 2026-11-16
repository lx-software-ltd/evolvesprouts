# Plan: Clear Dependabot minimatch GHSA-g3hv-75wg-m249

**Status**: Done
**Zone**: green for training lockfile; red for CDK lockfile and the bundled-dep patcher

## Goal

Stop Dependabot Updates from failing on `minimatch` security jobs in `/apps/training` and `/backend/infrastructure`.

Copying `minimatch@11` over the `aws-cdk-lib` bundle is not enough. The lockfile still recorded `minimatch@10.2.6` with `inBundle: true`, and the security job failed as `security_update_not_possible`. The postinstall script now records the patched 11.x version in `package-lock.json`. `npm ci` keeps that entry. `npm install` restores 10.2.6 from the tarball, and the script writes 11.x back.

## Non-goals

- Do not bump ESLint's `minimatch` 3.x to 11.x (different API).
- Do not change CDK stacks, IAM, or deploy workflows.

## Files

- `apps/training/package.json` and lockfile: override `minimatch@10` to `11.0.4`.
- `backend/infrastructure/package.json`, lockfile, and `scripts/patch-bundled-aws-cdk-lib-deps.js`: same override for typescript-eslint; copy minimatch 11.0.4 over the `aws-cdk-lib` bundle and record that version in the lockfile.
- `.github/dependabot.yml`: remove the `minimatch` ignore that now fails the job as `all_versions_ignored`.
- `apps/admin_web` and `apps/public_www`: same `minimatch@10` override so the next solo security job does not fail.

## Invariants this change preserves

- ESLint still resolves `minimatch` 3.1.5.
- CDK construct code is unchanged.
- Training and admin/public tests still run.

## Done when

- Lockfiles contain no `minimatch` 10.x, including the `aws-cdk-lib` bundled entry.
- `npm run lint` and the area tests pass.
- Check Lockfiles `npm ci` leaves the lockfiles unchanged.

## Rollback

Revert the commit.

## Open questions

None. The user asked to clear the failing Dependabot updates.
