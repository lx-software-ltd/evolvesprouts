# Plan: Dry-run Amplify releases

**Status**: In progress
**Zone**: red

## Goal

Before each existing `aws amplify start-job`, compare `amplify-release` with that command. `start-job` is recorded and not sent. `list-jobs` still calls AWS so a promote still requires a successful source job. The comparison is `continue-on-error: true`. `WAIT` is false, so the action returns after the stubbed start.

## Non-goals

- No switch. "Trigger Amplify Hosting release" and "Promote to target branch" stay the current commands.
- No pin change. The checkout `ref` is not a `uses` pin.
- No second RELEASE from the comparison.

## Files

`.github/workflows/deploy-admin-web.yml`, `.github/workflows/amplify-promote.yml`, this plan.

## Invariants this change preserves

- The real steps still call `aws amplify start-job` with the same arguments.
- A promote still checks the source branch before the comparison starts a stubbed job.

## Done when

Workflow conformance passes. After merge, a `main` run prints `Dry run matches the current deploy (1 planned Amplify RELEASE)` and the real step still starts a job. Only then does a follow-up replace the command.

## Rollback

Revert the pull request.

## Open questions

None.
