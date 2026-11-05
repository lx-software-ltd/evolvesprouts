# Plan: Show Eventbrite sync notices

**Status**: Done
**Zone**: yellow

## Goal

An admin can read why an Eventbrite sync stayed published or skipped a closed event. The notice uses Eventbrite's own unpublish error. A closed remote event is not edited. A non-400 unpublish failure still fails the sync.

## Non-goals

- Creating a replacement event when Eventbrite has canceled the listing.
- Deleting ticket classes, or lowering quantity below tickets sold.
- A new database column or a resync button.

## Files

- `backend/src/app/services/eventbrite_publish.py`
- `backend/src/app/services/eventbrite_sync.py`
- `backend/src/app/services/eventbrite_venue.py`
- `backend/src/app/api/admin_services_serializers.py`
- `docs/api/admin.yaml`
- `docs/architecture/aws-messaging.md`
- `apps/admin_web/src/types/generated/admin-api.generated.ts`
- `apps/admin_web/src/types/services.ts`
- `apps/admin_web/src/lib/services-api-parse.ts`
- `apps/admin_web/src/components/admin/services/instance-detail-panel.tsx`
- `tests/test_eventbrite_publish.py`
- `tests/eventbrite_sync_fakes.py`
- `tests/test_admin_services_instance_metadata.py`
- Admin instance fixtures and the instance panel tests

## Invariants this change preserves

- A draft event is still published. A live or started event is still updated and left published.
- A 400 from unpublish stays `synced` so the queue does not retry it.
- Any other unpublish failure stays `failed` and increments the retry count.
- Create and update request bodies do not send `eventbrite_last_error`.
- `eventbrite_sync.py` stays at or under 500 lines.

## Done when

`pytest tests/test_eventbrite_publish.py tests/test_eventbrite_sync_payload.py tests/test_eventbrite_logo.py tests/test_eventbrite_landing_description.py tests/test_eventbrite_client_service.py tests/test_admin_services_instance_metadata.py` passes. `pre-commit run ruff-format --all-files` passes. `python3 scripts/check_python_file_length.py` passes. In `apps/admin_web`, `npm run lint` and `npx vitest run tests/components/admin/services/instance-detail-panel.test.tsx tests/lib/services-api.test.ts` pass.

## Rollback

Revert the commit. The column already exists. Admin stops showing it, and sync goes back to editing closed events and using one unpublish sentence.

## Open questions

None. The editor shows the stored notice under the Eventbrite status. A failed sync uses the same field, in red.
