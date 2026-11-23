# Plan: Switch the admin site to s3-cloudfront-deploy

**Status**: Done. Deploy Admin Web `45149638489` succeeded, and the response headers matched.
**Zone**: red

## Goal

Replace the admin deploy script with `s3-cloudfront-deploy` profile `next-export`. The dry run matched twice: `45135961401` (134 planned S3 changes) and `45142832504` (130 planned S3 changes).

## Non-goals

- No change to siutindei in this pull request.
- No change to the local script `scripts/deploy/deploy-admin-web.sh`.
- No Amplify release. That step was skipped on the matching runs.

## Files

`.github/workflows/deploy-admin-web.yml`, this plan.

## Invariants this change preserves

- The build still comes from `apps/admin_web/out`.
- The bucket and distribution still come from `evolvesprouts-admin-web`.
- The sync is still `aws s3 sync --delete` followed by a CloudFront invalidation.
- The actions pin stays `ffde04dca3c78b1ccb8739f4d3a23f728ac7a05f`.

## Done when

The workflow calls `s3-cloudfront-deploy` and the dry-run comparison is gone. After merge, one Deploy Admin Web succeeds, and `https://admin.evolvesprouts.com/` still returns HTTP 200, `content-type: text/html`, `server: AmazonS3`, and `x-amz-server-side-encryption: AES256` through CloudFront.

## Rollback

Revert the pull request and run Deploy Admin Web again. The script is still in the repository.
