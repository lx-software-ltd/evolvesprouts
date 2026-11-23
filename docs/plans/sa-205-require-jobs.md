# Plan: Call require-jobs from the lint and test gates

**Status**: In progress
**Zone**: yellow

Parent plan: Shared actions repository and CI convergence, `lx-software-ltd/actions` `docs/plans/shared-actions-and-ci-convergence.md`, step SA-205.

`findingalpha` #72 merged first, at `d924cc4b1bdee7477b49b3352eccd7a4762639ea`. This pull request, #2270, merges after that.

## Goal

The `lint` job in `.github/workflows/lint.yml` and the `test` job in `.github/workflows/test.yml` replace their inline Python gate with `lx-software-ltd/actions/require-jobs@1a3cca7c38163f8164c262323601c34a4df5b7a4`. Each step passes `needs-json: ${{ toJson(needs) }}`. The action fails unless every needed job succeeded. `ubuntu-24.04` already provides `python3`, so the gate does not install Python.

## Non-goals

- No change to step names, `if: always()`, `needs` lists, job ids, job names, or the `ubuntu-24.04` runners.
- No `setup-python` step on the gate.
- No `allow-skipped` input. The action default stays in force.
- No change to checkout refs or any other action pin.
- No edit to `check-lockfiles.yml`, deploy workflows, `verify-rulesets.yml`, PII scripts, or pre-commit.

## Files

- `.github/workflows/lint.yml`
- `.github/workflows/test.yml`
- `docs/plans/sa-205-require-jobs.md`

## Invariants this change preserves

- Check names stay the job `name` values. The required checks stay `lint` and `test`.
- `needs` still lists every other job in each workflow, and `if: always()` still runs the gate after a failed need.
- A result other than `success` still fails the gate. Skipped stays a failure because `allow-skipped` is not set.
- Workflow `permissions: contents: read` stays. The action does not call the GitHub API.

## Check names on main

Rollout step 2. `main` `aff0c818a3552308b041a89cf5d0fb7b3c9ad335` github-actions check names, all success:

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

## Check names on the pull request head

Rollout step 4. Head `930b15cfd9437de50b8db2510d87ab5bd8b12c5a`. The github-actions names are the same list, including `lint` and `test`, and both gates succeeded. Checkov, CodeQL, and Semgrep OSS are `github-advanced-security` uploads on the pull request. They are code-scanning results, not renamed jobs.

## Done when

- Both gate steps use the pinned action and `needs-json`, and the surrounding job fields are unchanged.
- A search of `tests/` and `scripts/` finds no assertion of the inline gate heredoc, so no test file changes.
- `pytest tests/test_agent_harness_checks.py::test_pytest_coverage_floor_is_enforced_in_ci` still passes.
- The two check-name lists above are the rollout evidence.
- This pull request merges after `findingalpha` #72, which has merged.

## Rollback

Revert this pull request. The inline Python gate steps return, and `main` protection keeps the previous commit reachable. Checkout refs, runners, deploy workflows, and `verify-rulesets.yml` are not in the change, so they stay as they are.

## Open questions

None.
