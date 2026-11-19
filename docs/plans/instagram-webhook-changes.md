# Plan: Instagram Login webhook messages

**Status**: Done
**Zone**: yellow

## Goal

Store Instagram Direct messages that Meta delivers on `entry.changes[]`
(`field: messages`, event in `value`) and on `entry.standby`. Those
deliveries currently return HTTP 200 and never become conversations.
Page `messages` uses that same `changes` envelope. Page `message_echoes`
are stored as outbound. Ignored change field names are logged without
message text. Standby events create contacts and sales leads.

## Non-goals

- Comments, mentions, live comments, reactions, seen, and postbacks.
- Graph history import.
- Taking Instagram thread control from another app.

## Files

- `backend/src/app/services/meta_ingest.py`
- `backend/src/app/services/meta_webhook_events.py`
- `tests/test_meta_ingest.py`
- `docs/api/public.yaml`
- `docs/architecture/decisions.md`
- `docs/architecture/lambdas.md`

## Invariants this change preserves

- `entry.messaging` still stores inbound and `is_echo` outbound messages.
- WhatsApp objects stay ignored on this webhook.
- The business Instagram handle is still not imported as a contact.
- Comment and mention `changes` are not stored.
- No schema or seed change.

## Done when

`pytest tests/test_meta_ingest.py` passes, including a payload that mixes
a `messages` change, a `comments` change, and a `standby` event, and a
Page payload that stores `field: messages`, stores `message_echoes` as
outbound, ignores `field: feed`, and logs the ignored field name.
`pre-commit run ruff-format --all-files` passes.

## Rollback

Revert the ingest change. Already-acked Meta deliveries are not replayed.

## Open questions

None. Meta documents `value` as the messaging event for Instagram Login,
and `standby` as the same event shape as `messaging`.
