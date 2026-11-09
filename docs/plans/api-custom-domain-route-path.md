# Plan: API custom domain route path

**Status**: Ready
**Zone**: yellow

## Goal

Make `https://api.evolvesprouts.com/prod/...` hit the same admin routes as
the execute-api URL. API Gateway includes the custom-domain base path in
`event["path"]` (`/prod/v1/...`). Execute-api leaves the stage off that
field (`/v1/...`). The admin router matches the execute-api shape, so the
custom domain currently returns 404.

## Non-goals

- Moving clients, Mailchimp, or WhatsApp onto the custom domain.
- Turning off the execute-api endpoint.
- Changing the base path mapping. It stays `prod` so a client swaps the host
  and keeps `/prod`.

## Files

- `backend/src/app/api/admin_request.py` — strip one leading `/{stage}`
  segment from `path` before routing.
- `backend/src/app/api/admin.py` — route on that copy of the event.
- `tests/test_admin_request.py`, `tests/test_admin_router.py`
- `docs/architecture/lambdas.md`
- `docs/plans/api-domain-staging-gate.md`

## Invariants this change preserves

- Execute-api paths stay unchanged. A path is stripped only when it starts
  with the stage from `requestContext.stage` as its own first segment.
- `requestContext.path` is left as API Gateway sent it, so share-link URLs
  can still recover the `/prod` prefix.
- The caller's event dict is not mutated.

## Done when

`pytest tests/test_admin_request.py tests/test_admin_router.py` passes.
After deploy, `GET https://api.evolvesprouts.com/prod/v1/mailchimp/webhook`
returns `{"message":"ok"}`, matching execute-api.

## Rollback

Revert the commit and redeploy. DNS can stay on the custom domain. Routes
there 404 again, and execute-api is unchanged.

## Open questions

None. `/health` stays IAM-protected, so its unauthenticated 403 is not the
routing check.
