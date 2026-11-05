# Plan: Eventbrite header image

**Status**: Done
**Zone**: red

## Goal

Each landing page gets a 1456×728 PNG banner: the Evolve Sprouts tree behind the hero photo, the same way the public site draws it. Eventbrite sync uploads that PNG as the event logo. The proxy accepts one file body and allows Eventbrite's upload bucket.

## Non-goals

- A database column for the uploaded image. The banner checksum is part of the payload hash only when a banner exists, and a changed event uploads again.
- Cropping the photo. The whole photo stays visible.
- Uploading any URL Eventbrite returns. The upload URL must match `EVENTBRITE_MEDIA_UPLOAD_URL` exactly.

## Files

- `apps/public_www/scripts/build-eventbrite-banners.mjs`
- `apps/public_www/scripts/validate-content.mjs`
- `apps/public_www/src/content/eventbrite-banners/`
- `backend/scripts/build_lambda_bundle.py`
- `backend/src/app/services/aws_proxy.py`
- `backend/src/app/services/eventbrite_logo.py`
- `backend/src/app/services/eventbrite_sync.py`
- `backend/src/app/services/eventbrite_tickets.py`
- `backend/infrastructure/lib/api-stack.ts`
- `tests/test_aws_proxy.py`
- `tests/test_eventbrite_logo.py`
- `tests/test_lambda_bundle_landing_pages.py`
- `docs/architecture/aws-messaging.md`
- `docs/architecture/lambdas.md`

## Invariants this change preserves

- Text HTTP proxy calls stay string bodies.
- A missing or invalid banner does not fail the sync.
- An upload failure does not fail the sync. The stored hash then omits the banner checksum, so the next save retries. The log records the HTTP status, not the signed upload fields.
- Events without a banner keep the previous payload hash.
- A successful upload stores the hash that includes the banner, so an unchanged event does not upload again.
- `description.html`, structured content, venue, tickets, and publish behaviour stay as they are.
- No new database column and no seed change.

## Done when

`pytest tests/test_aws_proxy.py tests/test_eventbrite_logo.py tests/test_eventbrite_sync_payload.py tests/test_lambda_bundle_landing_pages.py` passes. `pre-commit run ruff` and `ruff-format` pass on the edited Python. `python3 scripts/check_python_file_length.py` and `node scripts/check-lambda-docs.mjs` pass. `npm run test:infra` and `npx tsc --noEmit` pass in `backend/infrastructure`. `npm run validate:content` passes in `apps/public_www`.

## Rollback

Revert the commits. Images already on Eventbrite stay until replaced by hand.

## Open questions

None.
