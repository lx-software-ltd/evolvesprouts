# Bugbot

Review for behavior, security, and contract drift. The mechanical checks already cover formatting, file length, focused tests, Lambda doc drift, and agent-rule shape.

## Zones

Red paths need an explicit human approval noted in the pull request. Those paths are database migrations and seed data, billing and invoice PDFs, auth and authorizers, CDK, deploy workflows, `.github/workflows/verify-rulesets.yml`, and PII tooling. Flag a red-path edit that does not mention that approval.

## Invariants

- Secrets use `secretName` `${resourcePrefix}-<kebab-case>`. Do not use `Cors.ALL_ORIGINS`.
- A new or changed endpoint updates the CDK route, the OpenAPI spec, and `docs/architecture/lambdas.md` in the same change.
- Admin lists stay on the table-first primitives in `.cursor/skills/admin-crud-screen/SKILL.md`.
- Public website copy stays in locale JSON. Do not use `dangerouslySetInnerHTML`.
- Do not log raw emails, and do not use `print()` in production Python.

## Skip

- Do not ask for an 80% coverage target. Floors are ratchets in the vitest configs and `--cov-fail-under=70` in `.github/workflows/test.yml`.
- Do not ask to move rules back into `.cursorrules`. That file is a pointer. Rules live in `.cursor/rules/`.
