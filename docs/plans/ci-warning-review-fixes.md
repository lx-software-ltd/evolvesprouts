# Plan: Fix the review findings from the CI warning cleanup

**Status**: Implemented
**Zone**: red

## Goal

Correct the review findings on the CI warning cleanup that landed in `#2224`: the organization serializer must skip only `raiseload` relationships, the CDK comments and synthesized template must match the security-group and proxy-tag behavior, `unrs-resolver` install scripts stay allowed, the Lighthouse CI Chrome launcher pin is checked, copied OpenAPI descriptions are removed, the Ubuntu 24.04 Java comment matches the runner image, and the booking and poll tests wait for the state they cover.

## Non-goals

- Renaming live expense routes or inventing 2xx or 4xx responses. Those Redocly findings stay in `.redocly.lint-ignore.yaml`.
- Replacing `@lhci/cli`. It still declares `chrome-launcher` `^0.13.4` and loads it with `require`.
- Moving GitHub-hosted runners off `ubuntu-24.04`. `ubuntu-latest` follows GitHub's image schedule.
- The macOS arm64 queue notice.
- npm audit findings that require `audit fix --force`.
- Database migrations, seed data, invoice PDFs, and auth logic.

## Files

- `backend/src/app/api/admin_entities_serializers.py`
- `tests/test_admin_entities_serializers.py`
- `backend/infrastructure/lib/api-stack.ts`
- `backend/infrastructure/test/api-stack.test.ts`
- `.github/workflows/deploy-mobile.yml`
- `apps/admin_web/package.json`
- `apps/public_www/package.json`
- `apps/training/package.json`
- `apps/public_www/tests/lib/lhci-chrome-launcher.test.ts`
- `docs/api/admin.yaml`
- `docs/api/public.yaml`
- `redocly.yaml`
- `.redocly.lint-ignore.yaml`
- Generated admin and public API types
- Public website and training tests that flushed one microtask or left the FPS QR promise pending

## Invariants this change preserves

- Vendor organization lists still omit tags, members, and location when those relationships are marked `raiseload`.
- A relationship that is merely unloaded or expired still loads through its normal strategy.
- The Lambda and migration security groups stay retained on replacement and on stack delete.
- Stack tags still apply to the database proxy, cluster, and instances. Only `AWS::RDS::DBProxyTargetGroup` is excluded.
- The user-pool client still depends on the Google identity provider.
- `unrs-resolver`'s postinstall stays allowed. It is the fallback that installs the native binding when the optional package is missing.
- Lighthouse CI still calls `Launcher.getInstallations()` through `chrome-launcher` 0.15.2.
- Expense, share-link, and Mailchimp paths stay the same.
- Operation ids stay on the OpenAPI operations.

## Done when

- `pytest tests/test_admin_entities_serializers.py` passes.
- `npm run test:infra` in `backend/infrastructure` passes, including the new template assertions.
- `npx @redocly/cli lint docs/api/admin.yaml docs/api/public.yaml` prints no warnings.
- `npm run check:admin-api-types` and `npm run check:public-api-types` pass.
- The public website booking, consultation, and book-a-free-call tests, the training poll tests, and the Chrome launcher test pass with no `act(...)` warnings.

## Rollback

Revert the branch. No schema or seed change. Retained security groups are unchanged from `#2224`.

## Open questions

None.
