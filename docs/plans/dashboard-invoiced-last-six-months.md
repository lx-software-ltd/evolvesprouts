# Plan: Dashboard invoiced last six months

**Status**: Implemented
**Zone**: yellow

## Goal

I will add a half-width dashboard card after Top contact spenders. It lists the current Hong Kong calendar month and the five months before it, with the issued-invoice total for each month in the admin default currency.

## Non-goals

I will not add an API, change invoice issuance, or change Tax Position or Top contact spenders. I will not chart the months. I will not include draft or void invoices.

## Files

- `docs/plans/dashboard-invoiced-last-six-months.md` records this plan.
- `apps/admin_web/src/lib/dashboard-issued-invoice-months.ts` buckets issued invoice totals.
- `apps/admin_web/src/components/admin/dashboard/cards/issued-invoice-months-card.tsx` renders the card.
- `apps/admin_web/src/components/admin/dashboard/dashboard-page-body.tsx` places the card after Top contact spenders and reuses the issued-invoice payload.
- `apps/admin_web/tests/lib/dashboard-issued-invoice-months.test.ts` covers the month window, date choice, and FX skip.
- `apps/admin_web/tests/components/admin/dashboard/issued-invoice-months-card.test.tsx` covers loading, errors, and the six amounts.
- `apps/admin_web/tests/components/admin/dashboard/dashboard-page-body.test.tsx` expects the new heading.

## Invariants this change preserves

The dashboard still loads expenses and issued invoices once. Tax Position and Top contact spenders keep their data and layout. Money conversion still uses the admin default currency and skips a foreign currency when its FX multiplier is missing.

## Done when

`npx vitest run tests/lib/dashboard-issued-invoice-months.test.ts tests/components/admin/dashboard/issued-invoice-months-card.test.tsx tests/components/admin/dashboard/dashboard-page-body.test.tsx` and `npm run lint` in `apps/admin_web` pass.

## Rollback

Remove the card from the dashboard page and delete the new component, helper, and tests.

## Open questions

None. The month is the invoice date when that date is valid, otherwise the Hong Kong calendar date of `issuedAt`, matching tax revenue classification. Amounts are invoice totals.
