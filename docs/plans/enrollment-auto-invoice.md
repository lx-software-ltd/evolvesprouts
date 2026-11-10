# Plan: Invoice and payment on enrollment

**Status**: Done
**Zone**: red

`backend/src/app/services/customer_billing.py` and `customer_invoice_pdf.py` stay unchanged. The new path calls them. `ENROLLMENT_AUTO_INVOICE` is added on the admin Lambda, default `false`.

## Goal

A billable enrollment records one inbound payment and, when the flag is on, one invoice. The public website and the admin enrollment screen share that path. Free bookings, waitlisted bookings, and admin "bill later" enrollments stay uninvoiced.

## Non-goals

No schema or seed change. No backfill of existing enrollments. No change to manual Finance drafts except the guards below.

## Files

- `backend/src/app/services/enrollment_invoice_links.py`
- `backend/src/app/services/enrollment_billing.py`
- `backend/src/app/services/enrollment_invoice_build.py`
- `backend/src/app/api/admin_billing_invoices.py`
- `backend/src/app/api/admin_billing_invoice_drafts.py`
- `backend/src/app/api/admin_billing_payment_create.py`
- `backend/src/app/api/admin_billing_allocations.py`
- `backend/src/app/api/admin_billing_payments.py`
- `backend/src/app/api/admin_enrollments.py`
- `backend/src/app/api/public_reservations.py`
- `apps/admin_web` enrollment editor, list, and generated API types
- `docs/api/admin.yaml`, `docs/architecture/lambdas.md`, `docs/architecture/database-schema.md`

## Invariants this change preserves

- Invoice numbers are still allocated only at issue.
- A payment is allocated only after it succeeds.
- Issuing an invoice does not add a second positive inbound payment when the enrollment already has one.
- An enrollment is on at most one non-void invoice.
- A failed invoice step does not roll back the enrollment or its payment.

## Done when

`pytest` covers the guards, admin billing, public billing, cancellation, and confirm-to-allocate. Admin web lint and the enrollment editor test pass. `ENROLLMENT_AUTO_INVOICE` unset or `false` leaves invoices off.

## Rollback

Set `ENROLLMENT_AUTO_INVOICE` to `false` and redeploy. Enrollments created while it was on keep their invoices. Revert the commit to restore the admin client's second payment request.

## Open questions

None. Defaults accepted: no invoice for free bookings, bill-later is admin only, website invoices are emailed, admin email is a checkbox, only succeeded payments allocate, admin payment method defaults to FPS, receipts for succeeded payments above zero including Stripe, no backfill.
