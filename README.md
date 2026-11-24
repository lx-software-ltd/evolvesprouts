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
| `apps/public_www/` | The public website. |
| `apps/training/` | The training site: course forms and polls. |
| `apps/admin_web/` | The admin console. |
| `apps/evolvesprouts_app/` | The Flutter mobile app. |
| `backend/` | The Python API (`lambda/` and `src/app/`), the database migrations (`db/`), and the AWS CDK app (`infrastructure/`). |
| `shared/` | Config and styles the web apps share. |
| `tests/` | Backend tests. |
| `scripts/` | Checks, code generation, imports, and deploy scripts. |
| `docs/` | Architecture, API specs, and deployment runbooks. |

## Working here

Read [`AGENTS.md`](AGENTS.md) before changing anything. The zone map,
[`docs/architecture/zones.md`](docs/architecture/zones.md), says which paths
need a plan or an approval first.

### AI agent rules

Cursor loads `AGENTS.md` and `.cursor/rules/*.mdc`. Always-on constraints are
in `.cursor/rules/00-repository-core.mdc`. Area rules attach by path, and
procedures live in `.cursor/skills/`. `.cursorrules` is a legacy pointer.

The harness check fails CI, and `pre-commit run validate-agent-rules
--all-files` fails a commit, when those files grow past their size budget,
lose a `[why:]` tag, or drop a required skill. The hooks live in
`lx-software-ltd/actions`.

### Setup

All deployment prerequisites and configuration steps are now documented in
`docs/architecture/setup.md`.

### My Best Auntie instance UUIDs (local dev)

To print Aurora `service_instances.id` values for the My Best Auntie service (for aligning with
`GET /v1/calendar/public` instance data), run:

```
ATTESTATION_FAIL_CLOSED=false python backend/scripts/dump_mba_instance_uuids.py --execute
```

Without `--execute`, the script exits without connecting (see script docstring for `DATABASE_URL` requirements).

## Documentation

- [`docs/architecture/overview.md`](docs/architecture/overview.md): the
  components and how they fit together.
- [`docs/architecture/security.md`](docs/architecture/security.md): the
  security controls.
- [`docs/architecture/setup.md`](docs/architecture/setup.md): deployment
  prerequisites and configuration.
- [`docs/api/admin.yaml`](docs/api/admin.yaml) and
  [`docs/api/public.yaml`](docs/api/public.yaml): the API specs.
- [`docs/deployment/`](docs/deployment/): the deployment runbooks.

## Security

To report a vulnerability, follow [`SECURITY.md`](SECURITY.md). Do not open a
public issue.

## Licence

Licensed under the Apache License, Version 2.0. The full text is in
[`LICENSE`](LICENSE).
