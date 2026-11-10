# Plan: CloudWatch log fixes

**Status**: Approved
**Zone**: red

The user asked to solve the outstanding items from the 5–10 Nov 2026 log review. That approval covers the API Gateway account setting in `backend/infrastructure/**`.

## Goal

A concurrent WhatsApp webhook for a new `wa_id` stores the message on the conversation that won the insert, and the webhook returns 200. Database exception logs keep the constraint name and omit SQL and bound parameters.

API Gateway keeps the single account role that `RestApi` creates when `cloudWatchRole` is true. `ApiGatewayCloudWatchAccount` calls `UpdateAccount` on create and when that role ARN changes, because an unchanged `AWS::ApiGateway::Account` does not correct a role set outside the stack. Execution and access logs both use that role. A second account resource and a `delivery.logs.amazonaws.com` resource policy are not added.

## Non-goals

- Deploying the stack. `cdk deploy` stays a human step.
- Purging or redriving Eventbrite messages from this change. The datetime format and already-published guard are already in the deployed processor. Header upload already retries when the configured media URL changes, because a skipped upload stores the hash without the banner.
- Schema or seed data.

## Files

- `backend/src/app/services/whatsapp_ingest.py`
- `backend/src/app/utils/logging.py`
- `tests/test_whatsapp_ingest.py`
- `tests/test_logging_structured_formatter.py`
- `backend/infrastructure/lib/api-stack.ts` (also removes the unused `ApiGatewayLogRole`; the RestApi `CloudWatchRole` is the account role)
- `backend/infrastructure/test/api-stack.test.ts`
- `docs/architecture/aws-assets-map.md`
- `docs/architecture/security.md`

## Invariants this change preserves

- A WhatsApp message that already exists is still counted as a duplicate.
- An `IntegrityError` for a constraint other than `whatsapp_conversations_wa_id_idx` still fails the webhook.
- Application exception text that is not a database error stays in the log, including each link in a cause chain.
- A `DETAIL:` line that is not a Postgres key or constraint detail stays in the log.
- API Gateway method logging stays INFO with data trace off.
- One `AWS::ApiGateway::Account` per stack, which is one per account and region.

## Done when

`pytest tests/test_whatsapp_ingest.py tests/test_logging_structured_formatter.py` passes. `pre-commit run ruff-format --all-files` passes. `npm run test:infra` passes in `backend/infrastructure`.

## Rollback

Revert the commit. API Gateway keeps the previous account role until a later deploy. WhatsApp inserts go back to failing the losing request with 500.

## Open questions

None. The next deploy runs `ApiGatewayCloudWatchAccount`, which sets the regional CloudWatch role. That role is used by every API in the region.
