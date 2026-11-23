# Plan: Promote credentials after the build

**Status**: In progress
**Zone**: red

`promote-public-www.yml` is red. This pull request changes only that workflow. No workflow is dispatched.

## Goal

`npm ci` and the production build run before `aws-oidc`. The release-id read moves with the credentials, because the build does not use the release id. Maintenance mode still skips Node, `npm ci`, and the build. That skip reads `github.event.inputs.promotion_mode`, not a step output from the release read.

## Non-goals

- No pin change. The shared action stays `b40bb0725bf84f25a38641f6ca5ec6f4c2f14f98`.
- No change to Deploy Public Website. That workflow already assumes after the build.
- No account id in an `if` expression. No account id in git.
- No promote run.

## Files

`.github/workflows/promote-public-www.yml`, this plan.

## Invariants this change preserves

- `latest_staging`, `release_id`, and `maintenance_on` still resolve the same way.
- A missing account or region still fails in the validation step, before the build.
- The promotion script still runs only after the role is assumed.
- The account id is `secrets.AWS_ACCOUNT_ID` only.

## Done when

The credentials step is after "Build public website for production". Workflow conformance in enforce mode still reports one actions commit.

## Rollback

Revert this pull request.

## Open questions

None.
