# Plan: Clear the CI warnings left after the first pass

**Status**: Implemented
**Zone**: red

## Goal

Clear the 9 November 2026 (Hong Kong) CI warnings that the first pass left in place: the CDK `CfnResource.addDependency` deprecation, the CloudFormation deletion-policy warning on the Lambda and migration security groups, the RDS proxy target-group `Tags` warning, OpenAPI Spectral warnings, the `ubuntu-latest` Ubuntu 26 runner notice, the npm `allowScripts` notice for `unrs-resolver`, and the deprecated `glob` / `inflight` / `rimraf` chain under Lighthouse CI.

## Non-goals

- Renaming live expense routes. `{id}` is a UUID and the static `bulk-import-jobs` segment stays. Spectral's ambiguous-path rule is suppressed on those four templates with a comment.
- Inventing a 4xx response for the Mailchimp URL check. That handler always returns 200.
- Treating a 302 redirect as a 2xx response. Those two operations keep 302 and suppress the 2xx rule.
- Replacing `@lhci/cli`'s Chrome launcher with the ESM 1.x package. Lighthouse CI loads it with `require`.
- The macOS arm64 queue notice. iOS and lockfile jobs still need a macOS runner. Queue time is GitHub capacity.
- npm audit findings that require `audit fix --force`.
- Database migrations, seed data, invoice PDFs, and auth logic.

## Files

- `backend/infrastructure/lib/api-stack.ts`
- `docs/api/admin.yaml`
- `docs/api/public.yaml`
- Generated admin and public API types
- `.github/workflows/*.yml` runner labels
- `apps/admin_web/package.json`
- `apps/public_www/package.json`
- `apps/training/package.json`
- `apps/public_www/package-lock.json`
- Public website and training tests that warn about `act(...)` or the root layout

## Invariants this change preserves

- The user-pool client still depends on the Google identity provider before it is created.
- The two security groups stay retained on replacement. Stack deletion now retains them as well, which is what the existing replacement policy was protecting.
- Stack tags still apply to the database proxy, cluster, and instances. Only `AWS::RDS::DBProxyTargetGroup` is excluded, because that resource type rejects `Tags`.
- Expense, share-link, health, and Mailchimp paths stay the same.
- `unrs-resolver`'s postinstall stays skipped. The package already falls back when that script does not run.
- Lighthouse CI still calls `Launcher.getInstallations()` through a CommonJS build of `chrome-launcher`.

## Done when

- `npm run test:infra` in `backend/infrastructure` no longer prints `addDependency`, `W3011`, or the proxy target-group `Tags` warning.
- `npx @redocly/cli lint docs/api/admin.yaml docs/api/public.yaml` prints no Spectral warnings.
- `npm run check:admin-api-types` and `npm run check:public-api-types` pass.
- Workflow jobs use `ubuntu-24.04` instead of `ubuntu-latest`.
- Public website and training tests that previously printed `act(...)` warnings no longer do.

## Rollback

Revert the branch. Retained security groups are a deploy-time behavior change only after the next backend deploy. No schema or seed change.

## Open questions

None.
