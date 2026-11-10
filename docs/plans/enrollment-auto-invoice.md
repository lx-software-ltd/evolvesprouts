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
- `backend/src/app/services/enrollment_billing_release.py`
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

## Corrections

- Cancellation reads invoice rows with SQLAlchemy `Row`, voids an unpaid single-enrollment invoice, and flags a refund when the invoice is shared, allocated, or the enrollment has a succeeded charge.
- An enrollment edit is blocked only when `amount_paid` or `currency` actually changes.
- With the flag off, website bookings do not get a receipt, and confirming or recording a succeeded payment does not allocate. Admin "payment received" still gets a receipt.
- A website display-name override applies only to a contact bill-to.
- The issue-time payment stub is the uncovered remainder, not a skip of the whole invoice.
- A waitlisted enrollment records the payment chosen at creation and is invoiced from that payment on promotion. Cancelled and bill-later enrollments record nothing. Promotion does not invent a payment.
- Catalogue matching leaves a draft when the price cannot be determined (several ticket tiers, hourly consultation) and says so.
- The invoice PDF is rendered once, after the savepoint, so a rolled-back invoice does not upload a PDF.
- The website invoice email is finalized even when another post-booking hook fails.

## Open questions

None. Defaults accepted: no invoice for free bookings, bill-later is admin only, website invoices are emailed, admin email is a checkbox, only succeeded payments allocate, admin payment method defaults to FPS, receipts for succeeded payments above zero including Stripe, no backfill. Turning the flag on stays a CDK change because an unset variable already means off.
