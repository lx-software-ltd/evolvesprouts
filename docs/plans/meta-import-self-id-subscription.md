# Plan: Meta import self-id and Page subscription repair

**Status**: Done
**Zone**: yellow

## Goal

Make Graph inbox import identify the business Instagram account without
requiring `META_INSTAGRAM_USER_ID`, and repair a missing Page `messages`
webhook subscription at the start of each Graph import job without failing
the import.

## Non-goals

- Scheduled incremental sync (red-zone CDK; separate approval).
- New admin routes or InboxImport Lambda env changes (red-zone CDK).
- Changing live webhook lead creation.

## Files

- `backend/src/app/services/meta_history_sync.py`
- `backend/src/app/services/meta_graph_client.py`
- `backend/src/app/services/meta_page_subscription.py` (new)
- `backend/src/app/services/inbox_import_runner.py`
- `tests/test_meta_history_sync.py`
- `tests/test_meta_graph_client.py`
- `tests/test_meta_page_subscription.py` (new)
- `docs/architecture/setup.md`
- `docs/architecture/decisions.md`
- `docs/architecture/lambdas.md`

## Invariants this change preserves

- History import still sets `create_leads=False`.
- Unique `platform_message_id` still dedupes webhook and Graph rows.
- A missing or failed subscription check does not fail the import job.
- `META_INSTAGRAM_USER_ID` still works when set; it is no longer required
  for correct counterparty and outbound detection.

## Done when

- `pytest tests/test_meta_history_sync.py tests/test_meta_graph_client.py tests/test_meta_page_subscription.py` passes.
- The new history test stores a customer thread when participants are
  business then customer and `META_INSTAGRAM_USER_ID` is unset, with
  business messages outbound.
- `pre-commit run ruff-format --all-files` passes.
- `setup.md` no longer calls `CDK_PARAM_META_INSTAGRAM_USER_ID` optional
  as the only way to identify the business Instagram id.

## Rollback

Revert the commits. Existing conversation rows stay.

## Open questions

- Red-zone item 3 (scheduled incremental sync): wait for Standard Access
  confirmation or explicit insurance approval before CDK writes.
- Should polled incremental messages open sales leads? Recommendation:
  no (`create_leads=False`), matching history import.
