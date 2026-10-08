# Evolve Sprouts

Supporting Hong Kong families to raise their children through positive education!

## AI agent rules

Cursor loads `AGENTS.md` and `.cursor/rules/*.mdc`. Always-on constraints are
in `.cursor/rules/00-repository-core.mdc`. Area rules attach by path, and
procedures live in `.cursor/skills/`. `.cursorrules` is a legacy pointer.

`scripts/validate_agent_rules.py` fails CI and pre-commit when those files
grow past their size budget, lose a `[why:]` tag, or drop a required skill.

## Setup

All deployment prerequisites and configuration steps are now documented in
`docs/architecture/setup.md`.

### My Best Auntie instance UUIDs (local dev)

To print Aurora `service_instances.id` values for the My Best Auntie service (for aligning with
`GET /v1/calendar/public` instance data), run:

```
ATTESTATION_FAIL_CLOSED=false python backend/scripts/dump_mba_instance_uuids.py --execute
```

Without `--execute`, the script exits without connecting (see script docstring for `DATABASE_URL` requirements).
