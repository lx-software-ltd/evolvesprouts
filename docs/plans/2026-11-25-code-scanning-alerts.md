# Plan: Clear open code scanning alerts

**Status**: Done
**Zone**: yellow

## Goal

Clear the open Semgrep and CodeQL alerts. The HTTP proxy keeps its
allow-list and gains the in-source Semgrep mark. The landing-page check
refuses a non-https URL. The Meta assessment and the Figma pull keep
their operator output and mark the CodeQL heuristics that name campaign
fields and the saved Figma document.

## Non-goals

- No change to which HTTP URLs the proxy allows.
- No change to the Figma files that are written.
- No live ads or Figma calls.

## Files

- `backend/src/app/services/aws_proxy.py`
- `apps/public_www/marketing/scripts/apply/google-ads-apply-nov-restructure.py`
- `apps/public_www/marketing/scripts/meta-ads-assessment.py`
- `apps/public_www/scripts/figma/pull-figma-tokens.mjs`
- `scripts/cloudflare/staging_worker.py`

## Invariants this change preserves

The proxy still rejects URLs outside `ALLOWED_HTTP_URLS` and schemes
other than http and https. The existing proxy tests still pass.

## Done when

`python3 -m pytest tests/test_aws_proxy.py` passes.

## Rollback

Remove the comments and the https check on the landing-page helper.

## Open questions

None.
