# Plan: Eventbrite overview title gap and banner upload URL

**Status**: Done
**Zone**: yellow

## Goal

Each overview title on Eventbrite has twice the space above it. The header image uploads when Eventbrite returns the configured S3 bucket in another URL form.

## Non-goals

- Changing the landing-page copy or the banner images.
- Changing the CDK upload URL parameter or the proxy allowlist.
- Accepting a bucket other than the configured one.

## Files

- `backend/src/app/services/eventbrite_landing_description.py`
- `backend/src/app/services/eventbrite_logo.py`
- `tests/test_eventbrite_landing_description.py`
- `tests/test_eventbrite_logo.py`
- `docs/architecture/aws-messaging.md`

## Invariants this change preserves

- The image is still POSTed only to `EVENTBRITE_MEDIA_UPLOAD_URL`, so the proxy allowlist is unchanged.
- An upload URL for any other host or bucket is refused, and the sync continues without the image.
- Signed upload fields and query strings are not logged.
- The overview keeps its sections, order, and escaping.

## Done when

`pytest tests/test_eventbrite_landing_description.py tests/test_eventbrite_logo.py tests/test_eventbrite_sync_payload.py tests/test_eventbrite_publish.py` passes. `pre-commit run ruff` and `ruff-format` pass. `python3 scripts/check_python_file_length.py` passes.

## Rollback

Revert the commit. The overview loses the spacer. Eventbrite upload URLs must again match the configured URL exactly.

## Open questions

None. If the refusal log shows a different bucket, the `EventbriteMediaUploadUrl` stack parameter needs a deploy change.
