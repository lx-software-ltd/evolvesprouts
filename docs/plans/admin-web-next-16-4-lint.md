# Plan: Admin web Next 16.4 lint

**Status**: Implemented
**Zone**: yellow

## Goal

I will take the admin web minor and patch dependency bump from Dependabot pull request 2152 and make `npm run lint` pass on `eslint-plugin-react-hooks` 7.1.

## Non-goals

I will not rewrite fetch-on-mount hooks to a new loading pattern. I will not change invoice, payment, or list behavior. I will not edit the public website on this branch.

## Files

- `apps/admin_web/package.json` and `apps/admin_web/package-lock.json` take the Dependabot bump: Next and `eslint-config-next` 16.4.0, Vite 8.3.4, and the other listed patch updates.
- `apps/admin_web/src/hooks/use-paginated-list.ts` stops reading and writing refs during render. Fetcher identity and the explicit-refetch loading flag become state. The active query key ref updates in an effect. The list cache key memo uses a simple dependency.
- Fetch and reset effects that 7.1 newly reports get a local `react-hooks/set-state-in-effect` disable with a reason. The rule stays on for the rest of the app.
- `apps/admin_web/tests/hooks/use-paginated-list.test.ts` covers a fresh `queryKey` array with the same entries and an explicit refetch loading flag.

## Invariants this change preserves

List cache keys, page appending, `setItems`, aborted-request errors, and background revalidation stay as they are. Screen hooks still load when their inputs change.

## Done when

`npx vitest run tests/hooks/use-paginated-list.test.ts` and `npm run lint` in `apps/admin_web` pass.

## Rollback

Revert the commits on this branch.

## Open questions

None.
