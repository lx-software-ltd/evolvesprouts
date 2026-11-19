# Plan: Dashboard invoiced last six months

**Status**: Implemented
**Zone**: yellow

## Goal

I will add a half-width dashboard card after Top contact spenders. It lists the current Hong Kong calendar month and the five months before it, with the issued-invoice total for each month in the admin default currency.

The current month is labeled as still in progress. An invoice counts in the Hong Kong month of `issuedAt`, and in `invoiceDate` only when `issuedAt` is missing. A foreign amount uses the Frankfurter rate published on the issue date, or the latest rate within the previous seven days. A missing rate drops that amount, leaves the other months visible, and a month with only dropped amounts shows a dash instead of zero.

## Non-goals

I will not add an API, change invoice issuance, or change Tax Position or Top contact spenders. I will not chart the months. I will not include draft or void invoices.

## Files

- `docs/plans/dashboard-invoiced-last-six-months.md` records this plan.
- `apps/admin_web/src/lib/currency-converter.ts` loads a Frankfurter rate series for one pair and date range.
- `apps/admin_web/src/lib/dashboard-issued-invoice-months.ts` buckets issued invoice totals by issue date.
- `apps/admin_web/src/hooks/use-issued-invoice-month-fx-rates.ts` loads each foreign currency on its own and keeps the currencies that succeed.
- `apps/admin_web/src/components/admin/dashboard/cards/issued-invoice-months-card.tsx` renders the card.
- `apps/admin_web/src/components/admin/dashboard/dashboard-page-body.tsx` places the card after Top contact spenders and reuses the issued-invoice payload.
- `apps/admin_web/tests/lib/currency-converter.test.ts` covers the dated rate series.
- `apps/admin_web/tests/lib/dashboard-issued-invoice-months.test.ts` covers the month window, issue date, dated rates, and excluded months.
- `apps/admin_web/tests/hooks/use-issued-invoice-month-fx-rates.test.ts` covers a partial rate-load failure.
- `apps/admin_web/tests/components/admin/dashboard/issued-invoice-months-card.test.tsx` covers loading, the open month, and excluded amounts.
- `apps/admin_web/tests/components/admin/dashboard/dashboard-page-body.test.tsx` expects the new heading.

## Invariants this change preserves

The dashboard still loads expenses and issued invoices once. Tax Position and Top contact spenders keep their data, layout, and latest-rate conversion. This card converts into the admin default currency and names every currency it had to skip.

## Done when

`npx vitest run tests/lib/currency-converter.test.ts tests/lib/dashboard-issued-invoice-months.test.ts tests/hooks/use-issued-invoice-month-fx-rates.test.ts tests/components/admin/dashboard/issued-invoice-months-card.test.tsx tests/components/admin/dashboard/dashboard-page-body.test.tsx` and `npm run lint` in `apps/admin_web` pass.

## Rollback

Remove the card from the dashboard page and delete the new component, hook, helper, and tests. Revert the dated rate series in `currency-converter.ts`.

## Open questions

None. Amounts are invoice totals. The month is the Hong Kong date of `issuedAt`.
