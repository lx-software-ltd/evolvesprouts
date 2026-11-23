# Plan: Add lint and test merge gates

**Status**: In progress
**Zone**: yellow

Parent plan: Shared actions repository and CI convergence, step SA-101.
The parent is copied to `lx-software-ltd/actions` under `docs/plans/`.

## Goal

`lint.yml` reports a check named `lint` and `test.yml` reports a check named `test`. A pull request runs both workflows with no path filter, so a required check is never skipped. `push` to `main` keeps its path filter.

## Non-goals

- No change to what each existing job checks.
- No change of runner, action pin, or token permissions. Permissions are SA-102.
- No edit to `verify-rulesets.yml`.

## Files

- `.github/workflows/lint.yml`
- `.github/workflows/test.yml`
- `docs/plans/sa-101-lint-test-gates.md`

## Invariants this change preserves

- A pull request to `main` still cannot merge unless checks named `lint` and `test` pass.
- Existing job ids and names stay, so check-run names already reported stay.
- `push` path filters stay.

## Done when

The pull request workflow runs check names `lint` and `test`, and the other check names on `main` are unchanged except for those two additions.

`main` (`c1d46868bab842e0aa6998a65b6badbafe42b55f`) check names:

- Bandit Security Linter
- Check Flutter lockfiles
- Check iOS lockfiles
- Check Node.js lockfiles
- Checkov IaC Security
- Check Python requirements
- CodeQL Analysis (javascript-typescript)
- CodeQL Analysis (python)
- deploy
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

## Rollback

Revert the pull request. The path filters and the missing gate jobs return.
