# Plan: Clear today's CI warnings that are safe to change

**Status**: Implemented
**Zone**: yellow

## Goal

Remove warnings from the 9 November 2026 (Hong Kong) CI logs that sit in yellow or green paths: the SQLAlchemy `noload()` deprecation on vendor organization lists, Bandit comments that warn because they name tests that did not fail or because the comment prose is parsed as test ids, the Vite native config-loader warning, React DOM warnings from test mocks of `next/link` and `next/image`, the PyMuPDF `fitz` import warning, and the Node 22.21.1 engine warning for jsdom 30.

## Non-goals

- Follow-up warnings are handled in `docs/plans/ci-warning-leftovers.md`.
- npm audit low/moderate findings that npm says need `audit fix --force`.

## Files

- `backend/src/app/db/repositories/organization.py`
- `backend/src/app/api/admin_entities_serializers.py`
- `tests/test_organization_repository_default_scope.py`
- `tests/test_admin_entities_serializers.py`
- Bandit `# nosec` comments under `backend/src/app/**`
- `tests/test_customer_invoice_pdf.py`
- `apps/public_www/vitest.config.ts` renamed to `vitest.config.mts`
- `apps/training/vitest.config.ts` renamed to `vitest.config.mts`
- Public website test mocks that spread Next.js props onto DOM nodes
- `.github/workflows/lint.yml`
- `.github/workflows/check-lockfiles.yml`

## Invariants this change preserves

- Vendor organization lists still skip relationship queries. Summaries omit tags, members, and location when those relationships were not loaded.
- Lists that eager-load relationships still return tags, members, and location.
- Bandit suppressions that still match a finding stay in place. Only the explanatory words move to a normal comment.
- Invoice PDF assertions still open the generated PDF. The import name changes from the deprecated `fitz` module to `pymupdf`.
- Node stays on the 22 line. The pin moves from 22.21.1 to 22.22.2, which is the minimum jsdom 30 accepts.

## Done when

- `pytest tests/test_organization_repository_default_scope.py tests/test_admin_entities_serializers.py tests/test_organization_vendor_list_compat.py` passes with no `SADeprecationWarning`.
- `bandit -r src lambda -f txt --skip B310` from `backend/` prints no `nosec encountered` or `Test in comment` warnings for the edited files.
- `npx vitest run` in `apps/public_www` for the edited test files passes, and the Vite native-loader warning is gone.
- `pytest tests/test_customer_invoice_pdf.py -k test_v6_logo_size_and_position` passes with no `fitz` `FutureWarning`.

## Rollback

Revert the branch. No schema, seed, or deployed infrastructure change.

## Open questions

None. Red-zone warnings stay for a paired change.
