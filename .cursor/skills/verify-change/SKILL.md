---
name: verify-change
description: Choose the commands that prove a change and record the evidence in the pull request.
---

# Verify a change

Run the narrowest command that exercises the edit, then the area lint.

- Python: `pytest tests/<relevant_test>.py` and, before commit, `pre-commit run ruff-format --all-files`.
- Admin web: `npm run lint` and `npx vitest run <test>` in `apps/admin_web`. Dev server is `npm run dev -- --webpack --port 3000`.
- Public website: `npm run lint` and `npx vitest run <test>` in `apps/public_www`. Dev server port is 3001.
- Training: `npm run lint` and `npx vitest run` in `apps/training`. Dev server port is 3002.
- CDK: `npm run test:infra` in `backend/infrastructure` when a stack changed.
- Agent rules: `python3 scripts/validate_agent_rules.py`.

A UI behavior change is verified in the browser (click, type, submit, and the other screens that share the state), not by a single screenshot.

When web behavior changes, update the app's existing tests and fixtures. Keep mock responses aligned with `docs/api/*.yaml` and the current UI. Do not add Playwright.

Paste the commands and the result into the pull request. CI remains the merge gate. Integration tests that need Postgres run in CI via `TEST_DATABASE_URL`.

## Done

The pull request lists the zone, the checks you ran, and the docs or seed decision. Local harness scripts pass.
