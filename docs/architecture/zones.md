# Agent work zones

Autonomy follows blast radius. A change that touches more than one zone uses the stricter zone. If implementation spreads into a stricter zone, stop and ask.

## Red

Plan in chat and wait for explicit approval before any write. A human pairs on the change.

- `backend/db/**`
- `backend/src/app/services/customer_billing.py`
- `backend/src/app/services/customer_invoice_pdf.py`
- `backend/lambda/auth/**`
- `backend/lambda/authorizers/**`
- `backend/infrastructure/**`
- `.github/workflows/deploy-*.yml`
- `scripts/check-pii.sh`, `scripts/check_pii.py`, and `scripts/pii-denylist.sha256`

## Yellow

Write a short plan from `docs/plans/_template.md` before editing. Add or update tests first, then implement.

- Remaining `backend/src/app/**`
- `backend/lambda/**` outside the red list
- `apps/admin_web/src/**`
- `apps/evolvesprouts_app/**`

## Green

Implement and verify. Summarise intent in the pull request.

- `apps/public_www/**`
- `apps/training/**`
- `docs/**`
- Test-only edits that do not sit on a red path

Hooks still format edits and block destructive commands in every zone. CI remains the merge gate.
