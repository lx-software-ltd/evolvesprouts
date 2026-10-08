# Plan: Agent harness gap fixes

**Status**: Implemented
**Zone**: red

## Goal

I will close the gaps between the harness branch and the approved plan.

## Non-goals

I will not activate the disabled `main-protection` ruleset. I will not add Postgres to the Cloud VM. I will not add `CODEOWNERS`.

## Files

- `.github/workflows/test.yml` gains `--cov-fail-under=70`, because pytest-cov does not read `fail_under` from `pyproject.toml`.
- Admin web branch coverage floor moves to 60, and training statement coverage floor moves to 64, so each sits at least two points under the measured suite.
- `scripts/verify_github_rulesets.py` treats 403 on classic protection as unreadable and still evaluates rulesets. The workflow drops the invalid `administration` permission.
- Rule `[why:]` tags cite a commit only when `git log` supports the claim. The rest say `convention`.
- The Python length ratchet scans `backend/src` and `backend/lambda` only.
- `backend/src/app/services/customer_invoice_pdf.py` stays unchanged. `.github/workflows/verify-rulesets.yml` is red.
- `backend/infrastructure/test/stack-invariants.test.ts` checks secrets and CORS on the API stack and its nested stacks. The prefix comes from the `resourcePrefix` assignment in `api-stack.ts`.
- Locale key guidance matches `validate-content.mjs`, including `_comment` meta keys and kebab-case slugs.
- Dropped guidance returns to the scoped rules and skills: doc freshness, web tests, admin shell hooks, and the more-specific-rule conflict rule.
- Hooks use `afterFileEdit` (`file_path`) and `postToolUse` matcher `Write`. The shell guard is a shell wrapper. The environment install includes Ruff.
- `lint.yml` job name becomes `Validate agent rules`, and the redundant `.cursor/rules/**` path filter goes away.
- `BUGBOT.md` and this plan file land in the repo.

## Invariants this change preserves

Secret names, CORS, PII hashing, and the Alembic revision contract stay as they are. The invoice PDF file is not edited.

## Done when

`pytest tests/test_agent_harness_checks.py`, `python3 scripts/validate_agent_rules.py`, `python3 scripts/check_python_file_length.py`, `node scripts/check-lambda-docs.mjs`, and the API stack invariant test pass. `scripts/verify_github_rulesets.py` gets past the classic-protection 403 and then fails because `main-protection` is disabled.

## Rollback

Revert the commit that introduces these fixes.

## Open questions

None.
