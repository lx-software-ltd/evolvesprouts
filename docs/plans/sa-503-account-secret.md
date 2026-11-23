# Plan: SA-503 account id secret

**Status**: In progress
**Zone**: red

The workflows that assume `GitHubActionsRole` change which value they read. No actions pin moves. No workflow is dispatched.

## Goal

Workflows read `secrets.AWS_ACCOUNT_ID`. They no longer read `vars.AWS_ACCOUNT_ID`. A step `if` checks `vars.AWS_REGION` and the other variables it already checked. The account id is not placed in an `if` expression. After this merges, the `AWS_ACCOUNT_ID` variable is not read and can be deleted.

## Non-goals

- No switch to `aws-oidc`, `cdk-bootstrap-check`, `cdk-diff`, or `cfn-stack-outputs`.
- No change to the actions pin or `.pre-commit-config.yaml`.
- No deploy, bootstrap, promote, or import run.

## Files

The workflows under `.github/workflows` that assumed the role, `docs/architecture/setup.md`, `docs/architecture/decisions.md`, and this plan.

## Invariants this change preserves

- Credential steps stay where they are. The public website still assumes the role after the build.
- `AWS_REGION` stays a variable.
- An empty account or region still skips the legacy CRM import instead of failing the job.
- The actions pin is unchanged.

## Done when

No workflow contains `vars.AWS_ACCOUNT_ID`. No `if` expression contains `secrets.AWS_ACCOUNT_ID`. Workflow conformance in enforce mode passed.

## Rollback

Revert this pull request. The previous expression is `vars.AWS_ACCOUNT_ID`.

## Open questions

None.
