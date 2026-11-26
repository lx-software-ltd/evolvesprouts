# Plan: one API standard

**Status**: In progress
**Zone**: red

## Goal

Give evolvesprouts the shared API shape. The first pull request changes the
server. The next pull request changes the clients. The draft removes the old
paths after the owner steps.

The written standard is `docs/plans/api-standard.md` in
`lx-software-ltd/actions` at
`dadcbf4d63519cb93117f85925b6f90e013e057b`.

## Non-goals

Scope names, token expiry, generated clients, and a staging API.

## Files

- `backend/infrastructure/lib/api-stack.ts`
- `backend/infrastructure/test/api-stack.test.ts`
- `backend/lambda/authorizers/api_token/**`
- `backend/src/app/auth/api_token_authorizer.py`
- `backend/src/app/api/admin.py`
- `docs/api/*.yaml`

## Invariants this change preserves

- The stack test fails when the API stack has more than 495 resources.
- The `prod` domain mapping stays until the draft removes it.
- `backend/db/**` and the billing files are not edited.

## Done when

The last pull request in this series deletes this note. Each pull request
records the commands from the actions plan.

## Rollback

Revert the unmerged pull request. A deployed server change is rolled back
by the previous task definition, as the actions plan describes.

## Open questions

None. The actions plan settled the shape.
