# Evolve Sprouts

Supporting Hong Kong families to raise their children through positive education!

Evolve Sprouts offers Montessori helper training, family consultations, and
events for families in Hong Kong with children aged 0 to 6. This repository is
the whole platform behind it: the public website where families find a course
and book it, the training site for course forms and polls, the admin console
the team runs the business from, the mobile app, and the backend API they
share.

This repository is public. Secrets and private personal data stay out of git.

## What is here

| Path | What it is |
| --- | --- |
| [`apps/public_www/`](apps/public_www/) | The public website. |
| [`apps/training/`](apps/training/) | The training site: course forms and polls. |
| [`apps/admin_web/`](apps/admin_web/) | The admin console. |
| [`apps/evolvesprouts_app/`](apps/evolvesprouts_app/) | The Flutter mobile app. |
| [`backend/`](backend/) | The Python API (`lambda/` and `src/app/`), the database migrations (`db/`), and the AWS CDK app (`infrastructure/`). |
| [`shared/`](shared/) | Config and styles the web apps share. |
| [`tests/`](tests/) | Backend tests. |
| [`scripts/`](scripts/) | Checks, code generation, imports, and deploy scripts. |
| [`docs/`](docs/) | Architecture, API specs, and deployment runbooks. |

## Working here

Read [`AGENTS.md`](AGENTS.md) before changing anything. The zone map,
[`docs/architecture/zones.md`](docs/architecture/zones.md), says which paths
need a plan or an approval first.

## Documentation

- [`docs/architecture/overview.md`](docs/architecture/overview.md): the
  components and how they fit together.
- [`docs/architecture/security.md`](docs/architecture/security.md): the
  security controls.
- [`docs/architecture/setup.md`](docs/architecture/setup.md): deployment
  prerequisites and configuration.
- [`docs/architecture/zones.md`](docs/architecture/zones.md): which paths
  need a plan or an approval first.
- [`docs/architecture/decisions.md`](docs/architecture/decisions.md):
  architecture decisions.
- [`docs/architecture/infrastructure-map.md`](docs/architecture/infrastructure-map.md):
  Cloudflare, AWS, the VPC, and deployments.
- [`docs/architecture/aws-assets-map.md`](docs/architecture/aws-assets-map.md):
  assets the backend deploy creates.
- [`docs/architecture/aws-messaging.md`](docs/architecture/aws-messaging.md):
  SNS and SQS.
- [`docs/architecture/lambdas.md`](docs/architecture/lambdas.md): the
  Lambda catalogue.
- [`docs/architecture/database-schema.md`](docs/architecture/database-schema.md):
  the Aurora schema.
- [`docs/architecture/audit-logging.md`](docs/architecture/audit-logging.md):
  database audit logging.
- [`docs/architecture/github-rulesets.md`](docs/architecture/github-rulesets.md):
  the rulesets on `main` and on `v*` tags.
- [`docs/architecture/marketing-stack.md`](docs/architecture/marketing-stack.md):
  the marketing stack.
- [`docs/architecture/analytics-ga4-gtm-runbook.md`](docs/architecture/analytics-ga4-gtm-runbook.md)
  and [`docs/architecture/analytics-change-log.md`](docs/architecture/analytics-change-log.md):
  GA4 and Tag Manager.
- [`docs/architecture/public-www-figma-pipeline.md`](docs/architecture/public-www-figma-pipeline.md):
  the Figma design pipeline.
- [`docs/api/admin.yaml`](docs/api/admin.yaml) and
  [`docs/api/public.yaml`](docs/api/public.yaml): the API specs.
- [`docs/deployment/admin-web.md`](docs/deployment/admin-web.md),
  [`docs/deployment/backend.md`](docs/deployment/backend.md),
  [`docs/deployment/public-www.md`](docs/deployment/public-www.md),
  [`docs/deployment/android-play-store.md`](docs/deployment/android-play-store.md),
  and [`docs/deployment/ios-testflight.md`](docs/deployment/ios-testflight.md):
  the deployment runbooks.
- [`docs/plans/README.md`](docs/plans/README.md): open plans.

## Security

To report a vulnerability, follow [`SECURITY.md`](SECURITY.md). Do not open a
public issue.

## Licence

Licensed under the Apache License, Version 2.0. The full text is in
[`LICENSE`](LICENSE).
