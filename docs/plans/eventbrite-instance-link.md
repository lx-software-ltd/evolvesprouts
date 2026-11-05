# Plan: Eventbrite event link on instance editor

**Status**: Done
**Zone**: yellow

## Goal

The instance editor shows a link to the Eventbrite event under the read-only Eventbrite status field when `eventbrite_event_url` is an http or https URL.

## Non-goals

- A resync button.
- Writing the Eventbrite URL from the editor.
- Changing Eventbrite sync.

## Files

- `backend/src/app/api/admin_services_serializers.py`
- `tests/test_admin_services_instance_metadata.py`
- `docs/api/admin.yaml`
- `apps/admin_web/src/types/generated/admin-api.generated.ts`
- `apps/admin_web/src/types/services.ts`
- `apps/admin_web/src/lib/services-api-parse.ts`
- `apps/admin_web/src/components/admin/services/instance-detail-panel.tsx`
- Admin instance fixtures and tests that construct `ServiceInstance`

## Invariants this change preserves

- Eventbrite status stays a read-only input.
- Instances without an Eventbrite URL stay without a link.
- `javascript:` and other non-http URLs are not rendered.
- Create and update payloads stay the same.

## Done when

`pytest tests/test_admin_services_instance_metadata.py` passes. `npx vitest run` for the instance panel and services-api tests passes. `npm run lint` in `apps/admin_web` passes.

## Rollback

Revert the commit.

## Open questions

None. Failed instances that never created an Eventbrite event have no URL until a later sync succeeds.
