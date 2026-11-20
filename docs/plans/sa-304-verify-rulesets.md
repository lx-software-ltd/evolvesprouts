# Plan: Pin the weekly ruleset check

**Status**: In progress
**Zone**: yellow

Parent plan: Shared actions repository and CI convergence, step SA-304.

This is the Monday fix. A pull request is opened. The setup samples now say 0 reviews.

## Goal

Gate G1. The Monday 23 Nov 2026 09:00 UTC run of Verify GitHub Rulesets stops failing with "main ruleset does not require at least 1 approving review." The verify step calls `lx-software-ltd/actions/verify-rulesets` pinned at `61d2a581a1d880533982bada88923ad1b6431700` (`# main 2026-11-20`). That action expects exactly 0 approving reviews and required checks exactly `lint` and `test`.

## Non-goals

No edit to `lint.yml`, `test.yml`, `security.yml`, deploy workflows, Amplify workflows, or `cdk-diff.yml`. No runner change and no checkout ref change. This workflow does not run on `pull_request`. No `workflow_dispatch` or `repository_dispatch` run is part of this change.

## Files

- `.github/workflows/verify-rulesets.yml`
- `scripts/verify_github_rulesets.py` (deleted)
- `tests/test_agent_harness_checks.py` (the two tests that load the deleted script are removed)
- `docs/architecture/github-rulesets.md`
- `docs/plans/sa-304-verify-rulesets.md`

## Invariants this change preserves

- The workflow name stays `Verify GitHub Rulesets`.
- The cron stays `"0 9 * * 1"`.
- `repository_dispatch` types stay `[verify-rulesets]`.
- `workflow_dispatch` stays.
- Permissions stay `contents: read`.
- The job id stays `verify-branch-protection`, with no job name.
- `runs-on` stays `ubuntu-24.04`.
- The checkout line stays `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`.
- The Summary step still points at `docs/architecture/github-rulesets.md`.
- This workflow does not run on `pull_request`.

## Done when

The verify step uses the pin above with `expected-reviews: "0"` and `required-checks: lint test`. `scripts/verify_github_rulesets.py` is deleted, and nothing else calls it. The "at least 1" error is not kept.

Check names on `main` (`bdf7b0f22518361c0f79d27d35c53e29758b6cab`) before the edit, all success:

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

## Rollback

Revert the pull request.
