# Plan: Hide scheduled events from public booking

**Status**: Done
**Zone**: yellow

## Goal

Scheduled event instances stay in admin with their session slots. They are omitted from `GET /v1/calendar/public` and `GET /www/v1/calendar/public`. An event reservation succeeds only when that instance status is `open`, `full`, or `in_progress`. Scheduled training-course instances stay on the public calendar and stay bookable.

## Non-goals

- Changing My Best Auntie cohort visibility.
- Changing `ServiceInstanceRepository.list_public_offerings` or calendar-blocker SQL.
- Eventbrite publish rules.
- Seed data or schema changes.
- Deploying this API. Until this code is deployed, the three future Saturday workshops are stored as `cancelled` with a note so the current feed hides them. After deploy, `scheduled` hides them the same way, and an operator sets status to `open` to put a date on sale.

## Files

- `backend/src/app/api/public_event_visibility.py`
- `backend/src/app/api/public_events.py`
- `backend/src/app/api/public_reservations.py`
- `tests/test_public_event_visibility.py`
- `tests/test_public_events_api.py`
- `tests/test_public_reservations_extended.py`
- `docs/api/public.yaml`
- `docs/architecture/lambdas.md`
- `docs/architecture/decisions.md`

## Invariants this change preserves

- Published `open` and `full` events stay on the feed and stay reservable.
- `in_progress` events stay on the feed and stay reservable, because the public status for those rows is still `open`.
- Cancelled events stay off the feed via the existing repository filter, and a direct reservation by slug is rejected.
- Completed events in the 90-day lookback stay on the feed and are not reservable.
- Scheduled training-course instances stay on the feed and stay reservable.
- Empty slugs stay omitted.
- `service_instance.py` stays at its allowlisted length. `public_events.py` and `public_reservations.py` stay at or under 500 lines.

## Done when

`pytest tests/test_public_event_visibility.py tests/test_public_events_api.py tests/test_public_reservations_extended.py::test_handle_public_reservation_rejects_scheduled_event` passes. A calendar request for a scheduled event slug returns no rows, and a scheduled training row is still returned.

## Rollback

Revert the helper and the two call sites. The public calendar lists scheduled events again. Set any workshop row that was marked `cancelled` only to hold it back to `scheduled` or `open`.

## Open questions

None.
