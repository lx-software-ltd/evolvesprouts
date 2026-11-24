# Plan: Name the dependency workflow Dependency Submission

**Status**: Done
**Zone**: green

`.github/workflows/dependency-graph.yml` and `.github/workflows/import-legacy-crm.yml` are not on the red list. Red workflows in `docs/architecture/zones.md` are `.github/workflows/deploy-*.yml` and `.github/workflows/verify-rulesets.yml`. These two files are not on the yellow list either (`backend/src/app/**`, `backend/lambda/**` outside red, `apps/admin_web/src/**`, `apps/evolvesprouts_app/**`). `docs/**` is green. This note is still required for the display-name edit.

## Goal

The Actions tab will use title case. GitHub's built-in "Dependency Graph" entry will sit next to this workflow, so the workflow will not use that name. The workflow display name will be `Dependency Submission`. The `check` job display name will be `Check Dependency Submission`. The `submit` job display name will be `Submit Dependency Submission`. The import workflow display name will be `Import Legacy CRM`.

## Non-goals

- Renaming workflow files, job ids, step names, pins, comments, permissions, or `ignore:` values.
- Editing `.pre-commit-config.yaml`.
- Adding a Sync Labels workflow. This repository has none.
- Renaming `Deploy iOS`.
- Adding tests. No existing test snapshots these display strings.

## Files

- `docs/plans/2026-11-24-dependency-submission-name.md`
- `.github/workflows/dependency-graph.yml` (workflow `name:` and the two job `name:` lines only)
- `.github/workflows/import-legacy-crm.yml` (workflow `name:` only)

## Invariants this change preserves

- Job ids stay `check`, `submit`, and `import`.
- The pin `lx-software-ltd/actions/dependency-graph@7d93bef212616595c866a76b03862eb72abbb746 # main 2026-11-23` stays, including every other pin.
- `ignore:` stays `apps/public_www/marketing/scripts/requirements.txt`.
- The import job name stays `Upload dump and run import Lambda`.
- workflow-conformance allow-lists describe-stacks findings for `.github/workflows/import-legacy-crm.yml` by path, so the display name can change without moving that allow-list.
- `Deploy iOS` stays spelled that way.

## Done when

`python3` on `lx-software-ltd/actions` `workflow-conformance/check_workflows.py` at `7d93bef212616595c866a76b03862eb72abbb746` prints `Workflow conformance passed.` with `CONFORMANCE_MODE=enforce`, `CONFORMANCE_PROFILE=product`, `CONFORMANCE_ROOT` set to this checkout, and `CONFORMANCE_ALIGNMENT=warn`. `.github/workflows/lint.yml` does not run actionlint, so that check is not part of this edit.

## Rollback

Revert the branch. The Actions tab will show the previous display names. No runtime, schema, or seed change.

## Open questions

None.
