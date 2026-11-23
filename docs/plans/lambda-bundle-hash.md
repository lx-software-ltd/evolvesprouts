# Plan: Keep rebuilt Lambda bundles out of the source hash

**Status**: In progress. The `.lambda-build/**` exclude is on main. The nested build directories are not.
**Zone**: yellow

## Goal

Stop Deploy Backend from updating every Lambda function when the source has not changed. `PythonLambda` hashes `backend/` with `AssetHashType.SOURCE`. `backend/.lambda-build` is recreated before synth. Bootstrap also rewrites `backend/infrastructure/cdk.out` before the deploy hash, and that directory contains zip timestamps. Exclude both. A pattern without a leading `**` does not match a directory under `infrastructure/`.

## Non-goals

- No change to the bundle contents or to which files are copied into the function.
- No change to the deploy workflow.

## Files

`backend/infrastructure/lib/constructs/python-lambda.ts`, this plan.

## Invariants this change preserves

- The function still publishes the prebuilt bundle from `.lambda-build`.
- A change under `backend/lambda` or `backend/src` still changes the hash.

## Done when

The exclude list contains `.lambda-build/**`, `**/cdk.out/**`, `**/node_modules/**`, `**/dist/**`, and `**/build/**`. The next source-only deploy still updates the functions once, because the hash changes. A later deploy with the same source should leave the function code unchanged. The `.lambda-build/**` exclude alone did not: Deploy Backend `45143397092` and `45143458088` each updated the same 27 functions.

## Rollback

Revert the pull request.

## Open questions

None.
