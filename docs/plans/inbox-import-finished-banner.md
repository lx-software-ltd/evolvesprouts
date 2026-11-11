# Plan: Dismiss inbox import finished banner

**Status**: Done
**Zone**: yellow

## Goal

The Sales Instagram and Messenger tabs stop treating the last stored import
job as a permanent banner. A finished import is a short confirmation. A stuck
or old job is not polled forever.

## Non-goals

- A new import-job read route. Listing stays the only read; CDK is out of scope.
- Changing the worker stale threshold or job persistence.
- Auto-hiding a failed import or an import that finished with skips.

## Files

- `apps/admin_web/src/hooks/use-inbox-import-job.ts`
- `apps/admin_web/src/lib/admin-query-keys.ts`
- `apps/admin_web/src/lib/inbox-import-api.ts`
- `apps/admin_web/src/components/status-banner.tsx`
- `apps/admin_web/src/components/admin/sales/inbox-import-status.tsx`
- `apps/admin_web/src/components/admin/sales/meta-conversations-view.tsx`
- `apps/admin_web/src/components/admin/sales/whatsapp-export-import-panel.tsx`
- `apps/admin_web/tests/hooks/use-inbox-import-job.test.tsx`
- `apps/admin_web/tests/components/admin/sales/meta-conversations-view.test.tsx`
- `apps/admin_web/tests/components/admin/sales/whatsapp-conversations-view.test.tsx`
- `apps/admin_web/tests/components/admin/sales/sales-page.test.tsx`
- `apps/admin_web/tests/components/status-banner.test.tsx`
- `apps/admin_web/tests/lib/inbox-import-api.test.ts`

## Invariants this change preserves

- Import still queues through `POST /v1/admin/meta/import-jobs` and WhatsApp
  export through `POST /v1/admin/whatsapp/import-jobs`.
- An in-flight job younger than the worker stale window (default lambda
  timeout 600s, times two, plus 120s) still shows after a refresh.
- The conversation list refetches only when a job this view was polling moves
  from in-flight to a terminal status.
- Instagram and Messenger each read only their own channel.

## Behavior

- Jobs older than that stale window are not restored and are not polled.
- A recent failure stays until Dismiss.
- A clean success from this browser tab hides after 20s, or sooner from
  Dismiss, and does not return on refresh.
- A success with skips stays until Dismiss. Leaving the tab before that
  still shows it when you come back, because this tab watched the job.
- A success from another visit is not restored.
- The job list uses the shared TanStack client. Polling is `refetchInterval`:
  2s while the inbox is visible, 10s while the WhatsApp import section is
  collapsed, and off when nothing in flight is still inside the stale window.

## Done when

`npx vitest run tests/hooks/use-inbox-import-job.test.tsx tests/components/admin/sales/meta-conversations-view.test.tsx tests/components/admin/sales/whatsapp-conversations-view.test.tsx tests/components/admin/sales/sales-page.test.tsx tests/components/status-banner.test.tsx tests/lib/inbox-import-api.test.ts` passes in `apps/admin_web`. `npm run lint` passes in `apps/admin_web`.

## Rollback

Revert the commit. The last stored job shows as a banner again.

## Open questions

None. There is no single-job read, so a poll still lists the newest page.
The page size stays the admin list default so an older in-flight job is not
dropped off a shorter page.
