# Plan: Call setup-node and setup-python from CI

**Status**: In progress
**Zone**: yellow

Parent plan: Shared actions repository and CI convergence, step SA-301.
The parent is `docs/plans/shared-actions-and-ci-convergence.md` in `lx-software-ltd/actions`.
`findingalpha` #73 merged this pin first. A pull request is opened for this repository.

## Goal

CI workflows call `lx-software-ltd/actions/setup-node` and `lx-software-ltd/actions/setup-python` at `c850872471a02a3f6112a9c5321b485e7f181443` (`# main 2026-11-20`). Each caller passes the Node or Python version it uses today. The `require-jobs` pin in `lint.yml` and `test.yml` moves from `1a3cca7c38163f8164c262323601c34a4df5b7a4` to that same commit.

## Non-goals

- No switch to the action default of Node 26 or to a Python version other than 3.12.
- No edit to deploy workflows, Amplify hosting workflows, the key workflow, or anything that deploys.
- No change to `runs-on`, checkout refs, `if:` conditions, or job names.
- No edit to PII scripts.

## Pin

Every `lx-software-ltd/actions` reference in the workflows this change touches is:

`c850872471a02a3f6112a9c5321b485e7f181443` `# main 2026-11-20`

## Files

Changed:

- `.github/workflows/lint.yml`
- `.github/workflows/test.yml`
- `.github/workflows/security.yml`
- `.github/workflows/check-lockfiles.yml`
- `.github/workflows/cdk-diff.yml`
- `.github/workflows/lighthouse-public-www.yml`
- `docs/plans/sa-301-setup-actions.md`

Left on `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` and, where present, `actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0`:

- `deploy-admin-web.yml`, `deploy-backend.yml`, `deploy-public-www.yml`, `deploy-training.yml` (deploy)
- `cdk-bootstrap.yml` (bootstrap deploy)
- `promote-public-www.yml` and `amplify-promote.yml` (Amplify hosting; the promote workflow is the one with setup-node)
- `figma-refresh-token.yml` (key workflow; it has no setup action)
- `figma-token-studio-sync.yml` (design-token sync, not a CI workflow)
- `smoke-public-www-staging.yml` (staging smoke against the hosted site, not a pull-request CI workflow)

`deploy-ios.yml`, `deploy-mobile.yml`, `import-legacy-crm.yml`, and `verify-rulesets.yml` have no setup-node or setup-python step.

## Versions preserved

Node `22.22.2`:

- Lint React
- Lint Python
- Lint CDK
- Check Node.js lockfiles

Node `lts/*`:

- Verify Public Website
- Verify Training Website
- Test Node
- Test Infrastructure
- Checkov IaC Security
- CDK Diff
- Lighthouse audit

Python `3.12`:

- Lint Python
- Lint CDK
- Test Python
- Test Infrastructure
- Python Dependency Audit
- Bandit Security Linter
- Checkov IaC Security

`npm ci` is folded into `setup-node` only where that following step is exactly `npm ci` in the lockfile directory. Those calls set `cache: npm` and `working-directory`, and leave `install` at its default:

- `backend/infrastructure` in Lint Python, Lint CDK, Checkov IaC Security, and CDK Diff
- `apps/public_www` in Lighthouse audit

These installs are not exactly `npm ci`, so the install step stays:

- Lint React and Check Node.js lockfiles pass only `node-version: "22.22.2"`. Their directory loops stay.
- Test Node and Test Infrastructure pass only `node-version: "lts/*"`. Their install scripts stay.
- Verify Public Website keeps its script and passes `node-version: "lts/*"`, `cache: npm`, `working-directory: apps/public_www`, and `install: "false"`.
- Verify Training Website does the same for `apps/training`.

Python callers that do not cache pip pass only `python-version: "3.12"` and keep their later pip steps. Lint Python is the caller that caches pip. It passes `requirements: "**/requirements.txt"`, which is the dependency path `actions/setup-python` used when `cache: pip` had no explicit path. The pre-commit pip install stays.

## Invariants this change preserves

- Job names, `needs`, `if: always()`, and other `if:` conditions stay.
- `runs-on` stays `ubuntu-24.04` on Linux jobs and `macos-latest` on the iOS lockfile job.
- Checkout refs stay, including `github.event.pull_request.head.sha`.
- Gate steps keep the step name and `needs-json: ${{ toJson(needs) }}`. `allow-skipped` stays unset.
- No secret is added.

## Check names on main

`main` `bdf7b0f22518361c0f79d27d35c53e29758b6cab`, `github-actions` app, before this change. Every run succeeded:

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
- lint
- Python Dependency Audit
- Secret Scanning
- Security Summary
- Semgrep SAST
- Test Flutter
- Test Infrastructure
- Test Node
- Test Python
- test
- Validate agent rules
- Verify Public Website
- Verify Training Website

## Done when

The six workflow files contain no `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1`, no `actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0`, and no `1a3cca7`. Every `lx-software-ltd/actions` reference in those files is `c850872471a02a3f6112a9c5321b485e7f181443`. The deploy, Amplify, key, and bootstrap workflows still use the pins listed above. `pytest tests/test_agent_harness_checks.py::test_pytest_coverage_floor_is_enforced_in_ci` passes.

## Rollback

Revert the pull request. The `actions/setup-node` and `actions/setup-python` steps return, the folded `npm ci` steps return, and the `require-jobs` pin returns to `1a3cca7c38163f8164c262323601c34a4df5b7a4`.

## Open questions

None.
