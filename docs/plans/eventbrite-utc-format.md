# Plan: Eventbrite sync UTC format

**Status**: Done
**Zone**: yellow

## Goal

Eventbrite event create and update send `start.utc` and `end.utc` as `YYYY-MM-DDThh:mm:ssZ`. The `timezone` field is the IANA name in `EVENTBRITE_DEFAULT_TIMEZONE` when that value is valid, and `UTC` when the variable is unset.

## Non-goals

- CDK, deploy workflow, or a new CloudFormation parameter. Wiring `EVENTBRITE_DEFAULT_TIMEZONE` into the processor Lambda is a later infrastructure change.
- Redriving the Eventbrite sync dead-letter queue.
- Changing the idempotency payload hash.
- Schema or seed data.

## Files

- `backend/src/app/services/eventbrite_sync.py`
- `tests/test_eventbrite_sync_payload.py`
- `docs/architecture/lambdas.md`
- `docs/architecture/aws-messaging.md`

## Invariants this change preserves

- Ticket class sync, publish, and unpublish requests stay the same.
- A missing session slot, title, or currency still fails the sync.
- An unchanged synced payload still returns `noop`.
- Unset `EVENTBRITE_DEFAULT_TIMEZONE` still sends timezone `UTC`, which is what Postgres `timestamptz` values produce today.

## Done when

`pytest tests/test_eventbrite_sync_payload.py` passes. `pre-commit run ruff-format --all-files` passes.

## Rollback

Revert the commit. Instances left in `failed` can be synced again after the previous build is deployed.

## Open questions

None. Production keeps timezone `UTC` until the processor environment sets `EVENTBRITE_DEFAULT_TIMEZONE`.
