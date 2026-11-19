# Plan: Webhook and invoice-month review fixes

**Status**: Done
**Zone**: yellow

## Goal

Accept Direct messages that sit under `changes[].value.messaging`, including
when `field` is `messages`. A Page `message_echoes` event still stores the
outbound message, and it does not open a contact or sales lead when the
thread is new. The invoiced-months card names a failed rate request
separately from a missing published rate, flags invoices with no currency,
says when a total used an earlier published rate, and moves to the next
Hong Kong month while the tab stays open.

## Non-goals

- Replaying webhook deliveries Meta already accepted.
- Changing the first-outbound lead rule for `entry.messaging` echoes.
- Shortening the 7-day rate lookback.

## Files

- `backend/src/app/services/meta_webhook_events.py`
- `backend/src/app/services/meta_ingest.py`
- `tests/test_meta_ingest.py`
- `apps/admin_web/src/lib/dashboard-issued-invoice-months.ts`
- `apps/admin_web/src/lib/fiscal-year.ts`
- `apps/admin_web/src/hooks/use-issued-invoice-month-fx-rates.ts`
- `apps/admin_web/src/components/admin/dashboard/cards/issued-invoice-months-card.tsx`
- Matching tests under `apps/admin_web/tests/`
- `docs/api/public.yaml`, `docs/architecture/decisions.md`, `docs/architecture/lambdas.md`

## Invariants this change preserves

- `entry.messaging` and `entry.standby` still store messages and may open a lead.
- A Page feed or comment change is not stored.
- An exact published rate still wins over an earlier one.
- An invoice with a blank currency is still added in the admin default currency.

## Done when

`pytest tests/test_meta_ingest.py` passes, including a `field: messages`
change whose event is under `value.messaging`, and a `message_echoes`-only
payload with `leads_created == 0`. `npx vitest run` covers the invoice-month
card, the FX hook, and the month totals. `meta_ingest.py` stays at or under
500 lines.

## Rollback

Revert this commit. Already-acked Meta deliveries are not replayed.

## Open questions

None. Live deliveries are documented as `entry.messaging`. The `changes`
shapes are accepted as well, including the App Dashboard test payload.
