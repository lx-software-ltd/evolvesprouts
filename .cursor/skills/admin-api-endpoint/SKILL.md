---
name: admin-api-endpoint
description: Add or change an admin or public API route across CDK, OpenAPI, and the Lambda catalog.
paths: backend/**,docs/api/**
---

# API endpoint

1. Register the route in `backend/infrastructure/lib/api-stack.ts` with the same path and method the Lambda handles.
2. Update `docs/api/admin.yaml` or `docs/api/public.yaml`.
3. Update the matching section in `docs/architecture/lambdas.md`.
4. For an admin route, run `npm run generate:admin-api-types` in `apps/admin_web` and commit the generated file. Do not hand-edit it.
5. Call the admin API from `src/lib/<resource>-api.ts` through `adminApiRequest` and `buildAdminListPath`.
6. In-VPC calls to Cognito or other AWS APIs go through `app.services.aws_proxy`.

## Done

`node scripts/check-cdk-admin-api-routes.mjs` and `node scripts/check-lambda-docs.mjs` pass. Admin type check passes when the admin spec changed.
