# Plan: Keep rebuilt Lambda bundles out of the source hash

**Status**: In progress
**Zone**: yellow

## Goal

Stop Deploy Backend from updating every Lambda function when the source has not changed. `PythonLambda` hashes `backend/` with `AssetHashType.SOURCE`. `backend/.lambda-build` is recreated before synth, and those bytes are not source. Exclude that directory from the hash. This is the same exclude already merged on siutindei.

## Non-goals

- No change to the bundle contents or to which files are copied into the function.
- No change to the deploy workflow.

## Files

`backend/infrastructure/lib/constructs/python-lambda.ts`, this plan.

## Invariants this change preserves

- The function still publishes the prebuilt bundle from `.lambda-build`.
- A change under `backend/lambda` or `backend/src` still changes the hash.

## Done when

The exclude list contains `.lambda-build/**`. The next source-only deploy still updates the functions once, because the hash no longer includes the build directory. A later deploy with the same source should leave the function code unchanged.

## Rollback

Revert the pull request.

## Open questions

None.
