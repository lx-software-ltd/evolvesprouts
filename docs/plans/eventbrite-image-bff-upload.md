# Plan: Eventbrite image upload URL

**Status**: Approved
**Zone**: red

## Goal

The header image uploads when Eventbrite returns `https://www.eventbrite.com/image-bff/api/upload`. Production deploys pass that URL, because CloudFormation keeps the previous parameter value when the key is omitted.

## Non-goals

- Changing the banner images or the overview HTML.
- Posting the file to the URL Eventbrite returns. The POST stays on the configured URL.
- Guessing a new multipart contract. Empty `upload_data` is allowed. A failure logs field names and the HTTP status.

## Files

- `backend/infrastructure/lib/api-stack.ts`
- `backend/infrastructure/params/production.json`
- `backend/infrastructure/test/api-stack.test.ts`
- `backend/src/app/services/eventbrite_logo.py`
- `tests/test_eventbrite_logo.py`
- `docs/architecture/aws-assets-map.md`
- `docs/architecture/aws-messaging.md`
- `docs/architecture/lambdas.md`

## Invariants this change preserves

- The file is POSTed only to `EVENTBRITE_MEDIA_UPLOAD_URL`, which is the proxy allowlist entry.
- A different host, path, user, port, or query string is refused. The sync still succeeds.
- Signed upload field values stay out of the logs.
- The same S3 bucket in path or host form is still accepted when that bucket is the configured URL.

## Done when

`pytest tests/test_eventbrite_logo.py` passes. `npm run test:infra` in `backend/infrastructure` passes. `pre-commit run ruff-format --all-files` passes.

## Rollback

Redeploy with `EventbriteMediaUploadUrl` set to `https://s3.amazonaws.com/eventbrite-uploader-incoming-prod/`. Omitting the parameter keeps the last value.

## Open questions

Whether the new endpoint accepts the same multipart body as the S3 bucket. The next sync log shows the HTTP status and the `upload_data` field names.
