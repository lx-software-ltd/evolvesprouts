# Plan: Eventbrite overview from landing-page JSON

**Status**: Done
**Zone**: yellow

## Goal

When a service instance slug matches a public landing-page file, Eventbrite structured content is that page's English copy (outline, agenda, how it works, FAQ, and coach). `description.html` stays the short summary. A physical location with a country code is sent as the venue. The payload hash gains the overview or venue only when one is sent. The Lambda bundle includes the JSON files.

## Non-goals

- Eventbrite header image upload. The current hero is a small WebP, and the media host is not on the proxy allow-list.
- Restoring the dropped `landing_page` column.
- Chinese copy. Eventbrite gets the `en` block.
- Call-to-action, spot counts, and booking-field labels.
- Hardcoded Mealtimes text in Python.

## Files

- `backend/src/app/services/eventbrite_landing_description.py`
- `backend/src/app/services/eventbrite_venue.py`
- `backend/src/app/db/repositories/eventbrite_instance.py`
- `backend/src/app/services/eventbrite_sync.py`
- `backend/scripts/build_lambda_bundle.py`
- `tests/test_eventbrite_landing_description.py`
- `tests/test_lambda_bundle_landing_pages.py`
- `docs/architecture/aws-messaging.md`
- `docs/architecture/lambdas.md`

## Invariants this change preserves

- An instance whose slug is not a landing page still sends the short database description.
- A missing, invalid, or unreadable JSON file does not fail the sync.
- Slug lookup cannot read outside the landing-page directory.
- Event times, timezone fallback, tickets, and publish behaviour stay as they are.
- No new database column and no seed change.

## Done when

`pytest tests/test_eventbrite_landing_description.py tests/test_eventbrite_sync_payload.py tests/test_lambda_bundle_landing_pages.py` passes. `pre-commit run ruff-format --all-files` passes. `python3 scripts/check_python_file_length.py` passes.

## Rollback

Revert the commit. Already-synced events keep the last Eventbrite description until the next save.

## Open questions

None. Header image waits on a wide JPEG or PNG and an allow-list change.
