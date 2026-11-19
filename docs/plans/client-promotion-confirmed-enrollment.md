# Plan: Promote prospect to client when enrollment is already confirmed

**Status**: Done
**Zone**: yellow

## Goal

Contacts who paid and were enrolled as `confirmed` (common for FPS / manual admin
enrollment) should get `relationship_type=client` so the contacts list shows the
🤝 icon. Mel Zhou is a live example: she paid for Tantrums and limits, has a
service instance and invoice, but stayed `prospect`.

## Non-goals

- Backfilling every historical prospect-with-invoice contact (except Mel Zhou,
  who is the reported case).
- Changing when enrollments auto-invoice or how payment allocation works.
- UI changes to the contacts list icon rules.

## Files

- `backend/src/app/services/billing_enrollment_confirmation.py`
- `backend/src/app/api/admin_enrollments.py`
- `tests/test_billing_enrollment_confirmation.py`
- `tests/` enrollment create/update coverage if present

## Invariants this change preserves

- Only `prospect` parties are promoted (partner / vendor / past_client unchanged).
- Cancellation does not promote.
- Promotion remains idempotent for parties already `client`.

## Done when

- `pytest tests/test_billing_enrollment_confirmation.py` and related enrollment
  tests pass.
- Creating or billing a `confirmed` enrollment promotes a prospect contact.
- Mel Zhou’s live contact is `client` (API check).

## Rollback

Revert the PR. Mel’s relationship can be set back to `prospect` in admin if
needed.

## Open questions

None.
