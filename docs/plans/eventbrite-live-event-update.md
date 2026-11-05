# Plan: Update a live Eventbrite event

**Status**: Done
**Zone**: yellow

## Goal

A save in admin updates an event that is already live on Eventbrite. Publish and unpublish run only when Eventbrite's status differs from the instance.

## Non-goals

- Deleting ticket classes, or lowering quantity below tickets sold.
- Changing currency, or turning a live in-person event into an online event.
- Creating a replacement event when Eventbrite has canceled the listing.
- Redriving the Eventbrite dead-letter queue.

## Files

- `backend/src/app/services/eventbrite_publish.py`
- `backend/src/app/services/eventbrite_sync.py`
- `backend/src/app/services/eventbrite_client.py`
- `backend/src/app/services/eventbrite_logo.py`
- `tests/test_eventbrite_publish.py`
- `tests/test_eventbrite_sync_payload.py`
- `tests/test_eventbrite_logo.py`
- `tests/test_eventbrite_client_service.py`
- `tests/eventbrite_sync_fakes.py`
- `docs/architecture/aws-messaging.md`

## Invariants this change preserves

- Create, venue, image, update, structured content, and tickets keep their order and payloads.
- A draft event is still published on the first sync.
- An event with no banner, overview, or venue keeps its previous hash.
- A usable banner that is not uploaded stays out of the stored hash.
- No new database column and no infrastructure change.

## Done when

`pytest tests/test_eventbrite_publish.py tests/test_eventbrite_sync_payload.py tests/test_eventbrite_logo.py tests/test_eventbrite_landing_description.py tests/test_eventbrite_client_service.py` passes. `pre-commit run ruff` and `ruff-format` pass. `python3 scripts/check_python_file_length.py` and `node scripts/check-lambda-docs.mjs` pass.

## Rollback

Revert the commit. The live event keeps whatever the last sync wrote.

## Open questions

None. A rejected unpublish stays `synced` with `eventbrite_last_error` set, so the queue does not retry it. A canceled remote event is the same: a notice, no new event.
