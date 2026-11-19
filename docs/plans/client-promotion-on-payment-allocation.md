# Plan: Promote CRM parties only when payment is allocated to an invoice

**Status**: Done
**Zone**: yellow

## Goal

Promote prospect contacts/families/organisations to `client` only when a
succeeded payment is allocated to an issued positive-total invoice. Cover both
the invoice bill-to party and linked enrollment parties (including enrollments
already stored as `confirmed`).

## Non-goals

- Promoting on enrollment create/update when status is `confirmed`.
- Promoting from chat/manual heuristics.
- Changing zero-total invoice issue behaviour beyond leaving it as-is.

## Files

- `backend/src/app/services/billing_enrollment_confirmation.py`
- `tests/test_billing_enrollment_confirmation.py`

## Invariants this change preserves

- Only `prospect` parties become `client`.
- Waitlisted/cancelled enrollments are not promoted by allocation.
- Zero-total invoice issue still only confirms `registered` enrollments.

## Done when

- `pytest tests/test_billing_enrollment_confirmation.py` passes.
- Allocation path promotes bill-to and already-confirmed enrollment parties.

## Rollback

Revert the PR.

## Open questions

None.
