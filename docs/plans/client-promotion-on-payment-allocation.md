# Plan: Promote CRM parties only when an invoice is fully paid

**Status**: Done
**Zone**: yellow

## Goal

Promote prospect contacts/families/organisations to `client` only when an
issued positive-total invoice is fully paid (`paid_at` set after payment
allocation). Cover the bill-to party and linked enrollment parties (including
already-`confirmed` enrollments). Part-payments, zero-total invoices, and
admin “promote to family/organisation” must not promote.

## Non-goals

- Reversing `client` on refund, allocation removal, or invoice void.
- One-off clean-up of contacts promoted under older rules.
- Schema changes.

## Files

- `backend/src/app/services/billing_enrollment_confirmation.py`
- `backend/src/app/api/admin_enrollments.py`
- `tests/test_billing_enrollment_confirmation.py`
- `tests/test_admin_enrollments_api.py`

## Invariants this change preserves

- Only `prospect` parties become `client`.
- All prospect members of a promoted family/organisation become clients.
- Registered enrollments may still be confirmed on allocation or zero-total
  issue without becoming clients.
- Promotion is one-way (no demotion on refund/void).

## Done when

- Part-payment: enrollment may confirm; party stays prospect.
- Full payment (`paid_at` set): party becomes client.
- Zero-total issue: enrollment confirms; party stays prospect.
- Admin promote-to-family/org: structural move only; party stays prospect.
- `pytest tests/test_billing_enrollment_confirmation.py tests/test_admin_enrollments_api.py` passes.

## Rollback

Revert the PR.

## Open questions

None. Historical clients kept as-is; a separate clean-up pass would be needed
to realign past data.
