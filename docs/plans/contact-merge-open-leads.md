# Plan: Collapse open sales leads during contact merge

**Status**: Done
**Zone**: yellow

## Goal

Contact merge will fold two open automated sales leads onto the keeper's open lead before it saves the move, so `sales_leads_one_open_contact_idx` no longer rejects pairs such as a free-guide parent and a WhatsApp stub. A leftover violation of that index will return HTTP 409 with a readable message.

## Non-goals

- No production merge of the blocked contact pair, or of any other contact, in this change. The fix has to be deployed before that retry.
- No schema or seed change.
- No admin-screen redesign. The existing merge error text will show the 409 message.

## Files

- `backend/src/app/services/record_merge_related.py` — collapse an incoming open automated lead into the keeper's open lead instead of moving `contact_id` first.
- `backend/src/app/services/record_merge.py` — translate that unique-index failure into `ConflictError`.
- `backend/src/app/services/contact_merge.py` and `lead_merge.py` — apply the translation on flush.
- `tests/test_record_merge.py` — unit coverage for the 409 translation.
- `tests/test_contact_merge_open_leads_postgres.py` — Postgres coverage for a free-guide parent plus a WhatsApp stub.
- `docs/api/admin.yaml`, generated admin types, and `docs/architecture/decisions.md` — document the 409 and the collapse.

## Invariants this change preserves

- Different emails, Instagram handles, families, or organisations still return 400.
- A manual open lead can sit beside an automated open lead. Only non-manual open stages are folded.
- The surviving lead row is the keeper contact's existing open lead. Its lead type becomes the higher rank of the two (free guide outranks a WhatsApp `other` lead).
- Notes and conversations on the folded lead move onto that surviving lead.
- Other integrity errors stay 500s.

## Done when

- `pytest tests/test_record_merge.py tests/test_admin_contacts_merge.py tests/test_admin_leads_merge.py tests/test_contact_merge_open_leads_postgres.py` passes. The Postgres tests skip without `TEST_DATABASE_URL` and run in CI. They passed locally against PostgreSQL 16 after `alembic upgrade head`.
- `pre-commit run ruff-format --all-files` passes.
- Admin API types match `docs/api/admin.yaml`.

## Rollback

Revert the commit. No data migration. Merges already saved stay saved.

## Open questions

None.
