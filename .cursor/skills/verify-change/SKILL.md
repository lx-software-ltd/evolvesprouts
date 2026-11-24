---
name: verify-change
description: Choose the commands that prove a change and record the evidence in the pull request.
---

# Verify a change

Run the narrowest command that exercises the edit, then the area lint.

- Python: `pytest tests/<relevant_test>.py` and, before commit, `pre-commit run ruff-format --all-files`.
- Admin web: `npm run lint` and `npx vitest run <test>` in `apps/admin_web`. Dev server is `npm run dev -- --webpack --port 3000`.
- Public website: `npm run lint` and `npx vitest run <test>` in `apps/public_www`. Browser checks: `npm run test:e2e`. Dev server port is 3001.
- Training: `npm run lint` and `npx vitest run` in `apps/training`. Dev server port is 3002.
- CDK: `npm run test:infra` in `backend/infrastructure` when a stack changed.
- Agent rules, file length, and test focus: `pre-commit run validate-agent-rules --all-files`, `pre-commit run check-file-length --all-files`, and `pre-commit run check-test-focus --all-files`.
- Personal data: `pre-commit run check-pii --all-files`. The hash list is `scripts/pii-denylist.sha256`.

A UI behavior change is verified in the browser (click, type, submit, and the other screens that share the state), not by a single screenshot.

When web behavior changes, update the app's existing tests and fixtures. Keep mock responses aligned with `docs/api/*.yaml` and the current UI. Public website browser checks live in `apps/public_www/e2e` and run with Playwright. Admin and training stay on Vitest.

Paste the commands and the result into the pull request. CI remains the merge gate. Integration tests that need Postgres run in CI via `TEST_DATABASE_URL`.

## Done

The pull request lists the zone, the checks you ran, and the docs or seed decision. Local harness hooks pass.
