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

## Follow-up: unusable instructions

The first sync after deploy logged `ValueError` with the six S3 field names present, and the proxy log shows no POST to the upload URL. So an instruction check refused the response before any upload. The log did not say which.

- `upload_method` and `file_parameter_name` default to POST and `file` when missing.
- `upload_token` only needs to be a non-empty string.
- Field values may span lines or be numbers. They sit in multipart bodies, not headers, so line breaks cannot inject a header. Field names are still restricted.
- The finalize response may carry the id under `image` or `media`.
- Every refusal logs a constant `reason` and the instruction key names. Values are never logged.

Done when `pytest tests/test_eventbrite_logo.py` passes with the new cases.

## Follow-up: the advertised URL is a stub

With the instruction checks relaxed, the 9:09 PM HKT sync ran the whole chain: POST to image-bff, finalize, event update with the image id. The listing still had no image. A bare POST to `https://www.eventbrite.com/image-bff/api/upload` with junk fields and an 8-byte file returns `200 {"success":true,"message":"Upload completed"}`, while the same POST to `https://s3.amazonaws.com/eventbrite-uploader-incoming-prod/` returns `403 AccessDenied`. The stub stores nothing; the bucket evaluates the signed policy.

- `EventbriteMediaUploadUrl` returns to the S3 bucket URL in the stack default and `production.json`.
- The sync accepts instructions when the advertised URL is the configured one or when `upload_data.bucket` is the configured bucket. The file is posted to the configured URL either way.
- The banner checksum includes the upload URL, so this deploy resends the banner and replaces the dead image record on the next save.
- A refusal logs the bucket name with the URL.

Done when `pytest tests/test_eventbrite_logo.py` and `npm run test:infra` pass.

## Follow-up: the stub diagnosis was wrong

The image that reached the listing carries the upload time `20261105-130911`, the 9:09 PM HKT sync that posted to image-bff. So image-bff does store the file; it processes it asynchronously and answers a generic 200, which is why the junk probe also got 200. With the bucket URL configured, the 9:47 PM HKT sync refused the upload because the instructions carry no usable `bucket` value.

- `EventbriteMediaUploadUrl` returns to `https://www.eventbrite.com/image-bff/api/upload` in the stack default and `production.json`.
- The sync code is unchanged apart from the comment. The signed-bucket path stays for a configured S3 bucket.
- The banner checksum includes the upload URL, so the next save re-uploads once and replaces the logo with the same image.
