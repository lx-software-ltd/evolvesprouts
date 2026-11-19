# Plan: Meta import review fixes

**Status**: Done
**Zone**: yellow + red (META_APP_ID CDK)

## Goal

Fix the high, medium, and low review findings on the Meta Graph import
and hourly incremental sync: stuck-job skip, per-thread watermarks,
app-scoped subscription repair, admin banner noise, incremental leads,
and related job-status / concurrency gaps.

## Non-goals

- Changing live webhook lead creation rules beyond polled incremental.
- A separate inbox import job kind (filter by `created_by` instead).

## Files

- `backend/src/app/services/meta_graph_sync_schedule.py`
- `backend/src/app/db/repositories/inbox_import_job.py`
- `backend/src/app/services/meta_history_sync.py`
- `backend/src/app/services/meta_page_subscription.py`
- `backend/src/app/services/inbox_import_runner.py`
- `backend/infrastructure/lib/api-stack.ts` (+ params / deploy / docs)
- `apps/admin_web/src/hooks/use-inbox-import-job.ts`
- `apps/admin_web/src/lib/inbox-import-api.ts`
- Tests and architecture docs

## Invariants this change preserves

- Manual history import still sets `create_leads=False`.
- Unique `platform_message_id` still dedupes.
- Subscription check failure does not abort the import.
- `audit.py` line-count allowlist is unchanged.

## Done when

Relevant pytest / vitest / infra tests pass and `check_python_file_length`
passes.

## Rollback

Revert the commits.

## Open questions

None. Incremental scheduled sync opens leads (`create_leads=True`) because
it stands in for missing live webhooks; manual backfill does not.
