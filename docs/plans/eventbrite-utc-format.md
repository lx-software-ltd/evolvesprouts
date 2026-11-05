# Plan: Eventbrite sync UTC format

**Status**: Done
**Zone**: red

The stack parameter and deploy workflow are included because the processor otherwise cannot receive a display timezone. Schema, seed data, and auth stay untouched.

## Goal

Eventbrite event create and update send `start.utc` and `end.utc` as `YYYY-MM-DDThh:mm:ssZ`. The `timezone` field is `EVENTBRITE_DEFAULT_TIMEZONE` when that value is `UTC` or an area/location IANA name. Unset, invalid, and `Etc/` values use `UTC` and do not fail the sync. The payload hash includes that timezone. Ticket quantity is an integer. The processor Lambda receives the timezone from CDK parameter `EventbriteDefaultTimezone`.

## Non-goals

- Redriving `evolvesprouts-eventbrite-sync-dlq`. Those messages still carry the old payload and would fail again until this build is deployed.
- Setting the GitHub variable `CDK_PARAM_EVENTBRITE_DEFAULT_TIMEZONE`. An empty value keeps timezone `UTC`.
- Schema or seed data.

## Files

- `backend/src/app/services/eventbrite_sync.py`
- `tests/test_eventbrite_sync_payload.py`
- `backend/infrastructure/lib/api-stack.ts`
- `backend/infrastructure/params/production.json`
- `backend/infrastructure/test/api-stack.test.ts`
- `.github/workflows/deploy-backend.yml`
- `docs/architecture/lambdas.md`
- `docs/architecture/aws-messaging.md`
- `docs/architecture/aws-assets-map.md`

## Invariants this change preserves

- Ticket class sync, publish, and unpublish requests stay the same apart from `quantity_total` being a JSON number.
- A missing session slot, title, or currency still fails the sync.
- An unchanged synced payload still returns `noop`.
- Unset `EVENTBRITE_DEFAULT_TIMEZONE` still sends timezone `UTC`.

## Done when

`pytest tests/test_eventbrite_sync_payload.py tests/test_eventbrite_client_service.py tests/test_eventbrite_sync_processor_handler.py` passes. `pre-commit run ruff` and `pre-commit run ruff-format` pass on the edited Python files. `npm run test:infra` passes in `backend/infrastructure`.

## Rollback

Revert the commit. Instances left in `failed` can be synced again after the previous build is deployed.

## Open questions

None. Listings stay on `UTC` until `CDK_PARAM_EVENTBRITE_DEFAULT_TIMEZONE` is set to an IANA area/location name and the stack is deployed.
