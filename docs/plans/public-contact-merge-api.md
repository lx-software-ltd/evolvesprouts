# Plan: Public contact merge API

**Status**: Done
**Zone**: red

The API Gateway method for this route lives in `backend/infrastructure/lib/api-stack.ts`. That registration is the existing public-token pattern: one static `merge` resource and `POST`, same authorizer as the other `/v1/public/contacts` writes. No new Lambda, authorizer, secret, parameter, or token scope.

## Goal

`POST /v1/public/contacts/merge` will merge CRM contacts for an `admin` scoped `x-api-token`, the same scope the other public contact writes use. The handler will call the existing admin `merge_contacts_request`, so identity fill, related-row moves, open-lead folding, Mailchimp archive, audit actor, and 400/409 behaviour stay the same as `POST /v1/admin/contacts/merge`. The audit actor will be `api-key:<id>`. `user` tokens will receive 403. A request will accept at most 10 contact ids. After commit, loser emails will be archived in Mailchimp; that call stays best effort.

## Non-goals

- No public lead merge. Leads stay on the Cognito admin API.
- No change to merge rules, schema, or seed data.
- No admin web change. The admin site already calls `/v1/admin/contacts/merge`.

## Files

- `docs/plans/public-contact-merge-api.md` — this plan.
- `tests/api/test_public_contacts.py` — admin dispatch, user 403, and non-POST 405.
- `backend/src/app/api/public/contacts.py` — route `merge` before the contact id parse and call `merge_contacts_request`.
- `backend/infrastructure/lib/api-stack.ts` — `POST /v1/public/contacts/merge` on the API-token authorizer.
- `docs/api/public.yaml` — path and request schema.
- `apps/public_www/src/types/generated/public-api.generated.ts` — regenerate from the spec.
- `docs/architecture/lambdas.md`, `docs/architecture/aws-assets-map.md`, `docs/architecture/decisions.md` — record the route.

## Invariants this change preserves

- `user` tokens stay GET-only on every public contact route.
- Conflicting emails, Instagram handles, families, or organisations still return 400.
- A leftover one-open-lead conflict still returns 409.
- Purchased-service labels and Mailchimp sync jobs stay off the token API.
- The website CloudFront `/www/*` allowlist does not gain this route.

## Done when

- `pytest tests/api/test_public_contacts.py tests/test_admin_contacts_merge.py` passes.
- `pre-commit run ruff-format --all-files` passes.
- `node scripts/check-cdk-admin-api-routes.mjs` and `node scripts/check-lambda-docs.mjs` pass.
- Public API types match `docs/api/public.yaml`.

## Rollback

Remove the `merge` resource from the API stack and the handler branch. Contact rows already merged stay merged; this route does not add a schema.

## Open questions

None.
