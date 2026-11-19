# Plan: Scheduled incremental Meta Graph sync

**Status**: Done
**Zone**: red (CDK) + yellow (worker)

## Goal

Enqueue an incremental `meta_graph` inbox import per channel on a schedule.
The worker reads conversations newest first, stops at the stored channel
watermark, keeps `create_leads=False`, and relies on unique message ids to
dedupe with webhooks.

## Non-goals

- Opening sales leads from polled messages.
- Changing the admin-triggered full recent import (still last 20 bodies).
- New admin routes.

## Files

- `backend/src/app/services/meta_history_sync.py`
- `backend/src/app/services/inbox_import_runner.py`
- `backend/src/app/services/meta_graph_sync_schedule.py` (new)
- `backend/src/app/db/repositories/inbox_import_job.py`
- `backend/src/app/db/audit.py`
- `backend/lambda/meta_graph_sync_scheduler/handler.py` (new)
- `backend/infrastructure/lib/api-stack.ts`
- `backend/infrastructure/test/api-stack.test.ts`
- `tests/test_meta_history_sync.py`
- `tests/test_meta_graph_sync_schedule.py` (new)
- `docs/architecture/lambdas.md`
- `docs/architecture/aws-assets-map.md`
- `docs/architecture/aws-messaging.md`
- `docs/architecture/decisions.md`

## Invariants this change preserves

- Live webhooks still create leads; Graph import (manual and scheduled)
  does not.
- Unique `platform_message_id` still dedupes webhook and Graph rows.
- Manual admin import remains a non-incremental recent backfill.

## Done when

- `pytest tests/test_meta_history_sync.py tests/test_meta_graph_sync_schedule.py` passes.
- `npm run test:infra` in `backend/infrastructure` covers the new schedule.
- Docs list the scheduler Lambda and EventBridge rule.

## Rollback

Revert the commits and remove the EventBridge rule / scheduler Lambda via
deploy. Existing conversation rows stay.

## Open questions

Resolved: polled messages do not open sales leads (`create_leads=False`).
