# Plan: Skip Meta Graph Fatal errors per conversation

**Status**: Done
**Zone**: yellow

## Goal

When Meta returns an internal Graph `Fatal` (HTTP 400, code `-1`,
subcode `2207085`) for one conversation or message page, keep any
messages already fetched, skip that thread, continue the import, and end
`succeeded_with_errors`. Log Graph job failures with status, code,
subcode, and `fbtrace_id` (no message text). Auth/permission failures
still fail the job.

## Non-goals

- Changing page size or the 20-message cap.
- Setting the production GitHub variable `CDK_PARAM_META_APP_ID` (ops;
  CDK wiring already landed in `#2262`).
- Changing Messenger timeout / 10-minute worker budget.

## Files

- `backend/src/app/services/meta_graph_client.py`
- `backend/src/app/services/meta_history_sync.py`
- `backend/src/app/services/inbox_import_runner.py`
- `tests/test_meta_graph_client.py`
- `tests/test_meta_history_sync.py`
- `docs/architecture/decisions.md` / `lambdas.md`

## Invariants this change preserves

- Token / permission failures (HTTP 401, Graph codes 190 and 200) still
  fail the job.
- Unique `platform_message_id` still dedupes.
- Commit-after-each-thread still applies.

## Done when

- Pytest covers: Fatal on a later message page keeps earlier pages,
  next conversation still imports, `skipped >= 1`.
- Client tests cover skippable Fatal vs non-skippable 190/401.
- Runner logs Graph failure fields.

## Rollback

Revert the commits.

## Open questions

None. `META_APP_ID` remains a deploy/config action (GitHub var already
referenced by CDK).
