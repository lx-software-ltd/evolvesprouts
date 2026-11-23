# Admin web deployment

`admin_web` is a static Next.js admin app hosted in S3 and served by CloudFront.

## Prerequisites

- ACM certificate in `us-east-1` for `admin.evolvesprouts.com`
- CloudFront alias configured with the domain above

## CDK parameters

Provide these parameters when deploying `evolvesprouts-admin-web`:

- `AdminWebDomainName`: `admin.evolvesprouts.com`
- `AdminWebCertificateArn`: ACM certificate ARN (us-east-1)
- `WafWebAclArn`: optional CloudFront WAF ACL ARN (us-east-1). Set to an
  empty string to deploy without WAF.

## Build and deploy

```
cd apps/admin_web
npm ci
npm run build
```

## Required build variables (GitHub Variables)

The admin web login requires these repository variables:

- `NEXT_PUBLIC_COGNITO_DOMAIN`:
  - Use `auth.evolvesprouts.com` when `CognitoCustomDomainName` is configured.
  - Otherwise use `{CognitoDomainPrefix}.auth.{region}.amazoncognito.com`.
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`:
  - Value from backend stack output `UserPoolClientId`.
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID`:
  - Value from backend stack output `UserPoolId`.

You can fetch output values with AWS CLI:

```bash
aws cloudformation describe-stacks \
  --stack-name evolvesprouts \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId' || OutputKey=='UserPoolId'].[OutputKey,OutputValue]" \
  --output table
```

From the repo root:

```bash
bash scripts/deploy/deploy-admin-web.sh
```

The deploy script reads `ADMIN_WEB_STACK_NAME` (default:
`evolvesprouts-admin-web`) when resolving CloudFormation outputs.

## CORS configuration

Set `CORS_ALLOWED_ORIGINS` (or CDK context `corsAllowedOrigins`) to include:

- `https://admin.evolvesprouts.com`
- `http://localhost:3000`

This is required if the admin app calls authenticated backend endpoints.
