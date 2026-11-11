# Plan: Dismiss inbox import finished banner

**Status**: Done
**Zone**: yellow

## Goal

The Sales Instagram and Messenger tabs will stop showing a permanent green
"Import finished" banner. The banner is a one-shot confirmation, not a stored
job record.

## Non-goals

- Changing inbox import job APIs, worker behavior, or job persistence.
- Adding a dismiss control to `StatusBanner`.
- Auto-hiding failed import banners (those stay until the next import).

## Files

- `apps/admin_web/src/hooks/use-inbox-import-job.ts`
- `apps/admin_web/src/lib/inbox-import-api.ts`
- `apps/admin_web/src/components/admin/sales/meta-conversations-view.tsx`
- `apps/admin_web/src/components/admin/sales/whatsapp-export-import-panel.tsx`
- `apps/admin_web/tests/hooks/use-inbox-import-job.test.tsx`
- `apps/admin_web/tests/components/admin/sales/meta-conversations-view.test.tsx`

## Invariants this change preserves

- Import still queues through `POST /v1/admin/meta/import-jobs` and WhatsApp
  export through `POST /v1/admin/whatsapp/import-jobs`.
- In-flight (`pending` / `processing`) jobs still show after a refresh.
- Failed jobs still show until a new import replaces them.
- Conversation rows still refetch after an import settles.

## Done when

`npx vitest run tests/hooks/use-inbox-import-job.test.tsx tests/components/admin/sales/meta-conversations-view.test.tsx tests/components/admin/sales/whatsapp-conversations-view.test.tsx tests/lib/inbox-import-api.test.ts` passes in `apps/admin_web`. `npm run lint` passes in `apps/admin_web`.

## Rollback

Revert the commit. The last stored job shows as a banner again.

## Open questions

None. A finished job is confirmation, not inbox state, so it should not return
on the next visit.
