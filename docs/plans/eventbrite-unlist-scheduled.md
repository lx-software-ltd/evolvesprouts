# Plan: Unlist a scheduled event on Eventbrite

**Status**: Done
**Zone**: yellow

## Goal

Moving an event instance from `open` to `scheduled` removes it from Eventbrite search, hides its ticket classes, and unpublishes the Eventbrite event when Eventbrite allows that. Moving it back to `open` or `full` lists the same event and shows the ticket classes again. A refused unpublish of a scheduled event is retried on the next save. A scheduled event stays `scheduled` when it fills. A scheduled training course still becomes `full`. `cancelled` and `completed` stay out of Eventbrite search.

## Non-goals

- Changing the Mealtimes workshop that is already live. Nothing is enqueued for rows that are not saved, and an unchanged payload does not sync.
- Deleting the Eventbrite event, or creating a replacement when Eventbrite has closed it.
- Hiding ticket classes for `cancelled` or `completed`. Those statuses still unpublish when the event is live.
- A new database column, API field, or infrastructure change.

## Files

- `backend/src/app/services/eventbrite_publish.py`
- `backend/src/app/services/eventbrite_sync.py`
- `backend/src/app/services/eventbrite_tickets.py`
- `backend/src/app/api/instance_capacity_status.py`
- `tests/test_eventbrite_publish.py`
- `tests/test_eventbrite_sync_payload.py`
- `tests/test_instance_capacity_status.py`
- `docs/architecture/aws-messaging.md`
- `docs/architecture/decisions.md`
- `docs/architecture/lambdas.md`

## Invariants this change preserves

- An `open` or `full` instance still publishes a draft and leaves a live event published.
- `listed` is false for `scheduled`, `cancelled`, and `completed`.
- Ticket classes stay unchanged for `cancelled` and `completed`.
- A 400 from unpublish stays `synced` so the queue does not retry it. Only a scheduled refusal clears the payload hash.
- Any other unpublish failure stays `failed` and increments the retry count.
- `eventbrite_sync.py` stays at or under 500 lines.

## Done when

`pytest tests/test_eventbrite_publish.py tests/test_eventbrite_sync_payload.py tests/test_eventbrite_logo.py tests/test_eventbrite_landing_description.py tests/test_eventbrite_client_service.py tests/test_instance_capacity_status.py` passes. `pre-commit run ruff-format --all-files` passes. `python3 scripts/check_python_file_length.py` passes.

## Rollback

Revert the commit. The next save uses the previous publish rules. Eventbrite keeps whatever the last sync wrote.

## Open questions

None.
