# Plan: Patch pypdf advisories blocking Dependabot CI

**Status**: Implemented
**Zone**: yellow

## Goal

Bump `pypdf` from 6.21.2 to 6.21.4 so Python Dependency Audit passes. Every open Dependabot pull request fails that job on the same seven advisories in `pypdf` 6.21.2. 6.21.4 is the current release and the fix version for CVE-2026-119203, CVE-2026-119204, and CVE-2026-119205. CVE-2026-119206, CVE-2026-119207, CVE-2026-119208, and CVE-2026-119209 are fixed in 6.21.3.

## Non-goals

I will not change PDF rendering, invoice layout, or receipt content. I will not ignore the advisories. I will not bump other backend packages on this branch.

## Files

- `backend/requirements.txt` and `backend/pyproject.toml` pin `pypdf==6.21.4`.
- The same commit is merged into each open Dependabot branch so those pull requests audit the patched pin before this lands on `main`.

## Invariants this change preserves

Invoice and receipt PDFs still parse with `PdfReader` and expose the same extracted text. `PYSEC-2025-183` stays ignored because PyJWT has no fix version and the advisory is disputed.

## Done when

`pip-audit -r backend/requirements.txt --ignore-vuln PYSEC-2025-183` reports no vulnerabilities. `pytest tests/test_customer_invoice_pdf.py tests/test_customer_receipt_pdf_service.py` passes on 6.21.4.

## Rollback

Revert the pin to `pypdf==6.21.2`.

## Open questions

None.
