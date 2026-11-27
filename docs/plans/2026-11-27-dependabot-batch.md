# Plan: Batch routine Dependabot updates

**Status**: Done
**Zone**: yellow

## Goal

This change will add `.github/workflows/dependabot-batch.yml` from the
shared template. The workflow will open one pull request for the
routine Dependabot updates. The owner will merge that pull request.
`docs/architecture/decisions.md` will say that, and will no longer tell
anyone to ask Dependabot to merge.

## Non-goals

No change to `.github/dependabot.yml`. No batch of workflow changes,
major updates, or the `actions-pin` group. No merge from this workflow.

## Files

- `.github/workflows/dependabot-batch.yml`
- `tests/test_dependabot_batch_workflow.py`
- `docs/architecture/decisions.md`
- `docs/plans/README.md`

## Invariants this change preserves

Top-level permissions stay `contents: read`. The job sets
`actions: write`, `checks: read`, `contents: write`, and
`pull-requests: write`. The action pin is the same commit as the other
workflows. The workflow is not a required check.

## Done when

`python3 -m unittest tests/test_dependabot_batch_workflow.py -v` passes,
and workflow conformance accepts the file against the template.

## Rollback

Delete `.github/workflows/dependabot-batch.yml` and
`tests/test_dependabot_batch_workflow.py`, and restore the Dependabot
command list in `docs/architecture/decisions.md`.

## Open questions

None.
