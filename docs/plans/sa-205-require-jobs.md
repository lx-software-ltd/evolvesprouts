# Plan: Call require-jobs from the lint and test gates

**Status**: In progress
**Zone**: yellow

Parent plan: Shared actions repository and CI convergence, step SA-205.

## Goal

The `lint` job in `.github/workflows/lint.yml` and the `test` job in `.github/workflows/test.yml` will replace their inline Python gate with the pinned composite action `lx-software-ltd/actions/require-jobs@1a3cca7c38163f8164c262323601c34a4df5b7a4`. Each step will pass `needs-json: ${{ toJson(needs) }}`. The action fails unless every needed job succeeded. `ubuntu-24.04` already provides `python3`, so the gate will not install Python.

## Non-goals

- No change to step names, `if: always()`, `needs` lists, job ids, job names, or the `ubuntu-24.04` runners.
- No `setup-python` step on the gate.
- No `allow-skipped` input. The action default stays in force.
- No change to checkout refs or any other action pin.
- No edit to `check-lockfiles.yml`, deploy workflows, `verify-rulesets.yml`, PII scripts, or pre-commit.
- No pull request and no workflow dispatch from this change.

## Files

- `.github/workflows/lint.yml`
- `.github/workflows/test.yml`
- `docs/plans/sa-205-require-jobs.md`

## Invariants this change preserves

- Check names stay the job `name` values. The required checks stay `lint` and `test`.
- `needs` still lists every other job in each workflow, and `if: always()` still runs the gate after a failed need.
- A result other than `success` still fails the gate. Skipped stays a failure because `allow-skipped` is not set.
- Workflow `permissions: contents: read` stays. The action does not call the GitHub API.

`main` (`aff0c818a3552308b041a89cf5d0fb7b3c9ad335`) github-actions check names:

- Bandit Security Linter
- Check Flutter lockfiles
- Check iOS lockfiles
- Check Node.js lockfiles
- Check Python requirements
- Checkov IaC Security
- CodeQL Analysis (javascript-typescript)
- CodeQL Analysis (python)
- Lint CDK
- Lint Dart
- Lint OpenAPI
- Lint Python
- Lint React
- Python Dependency Audit
- Secret Scanning
- Security Summary
- Semgrep SAST
- Test Flutter
- Test Infrastructure
- Test Node
- Test Python
- Validate agent rules
- Verify Public Website
- Verify Training Website
- lint
- test

## Done when

- Both gate steps use the pinned action and `needs-json`, and the surrounding job fields are unchanged.
- A search of `tests/` and `scripts/` finds no assertion of the inline gate heredoc, so no test file changes.
- `pytest tests/test_agent_harness_checks.py::test_pytest_coverage_floor_is_enforced_in_ci` still passes.
- This branch is pushed and no pull request is opened, so the workflows do not run yet.

## Rollback

Revert the commit. The inline Python gates return. `main` protection keeps the previous commit reachable.

## Open questions

None. A later pull request is what will run the checks.
