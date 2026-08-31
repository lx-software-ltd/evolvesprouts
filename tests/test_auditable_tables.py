"""Keep audit table allow-lists aligned across API, OpenAPI, and admin web."""

from __future__ import annotations

from pathlib import Path

from app.db.auditable_tables import AUDITABLE_TABLES

_REPO_ROOT = Path(__file__).resolve().parents[1]


def test_openapi_audit_table_enum_matches_auditable_tables() -> None:
    text = (_REPO_ROOT / "docs" / "api" / "admin.yaml").read_text(encoding="utf-8")
    start = text.index("/v1/admin/audit-logs:")
    table_block = text[start:]
    enum_start = table_block.index("name: table")
    enum_section = table_block[enum_start:]
    enum_header = enum_section.index("enum:")
    rest = enum_section[enum_header + len("enum:") :]
    names: list[str] = []
    for line in rest.splitlines()[1:]:
        stripped = line.strip()
        if not stripped.startswith("- "):
            break
        value = stripped[2:]
        if ":" in value or " " in value:
            break
        names.append(value)
    assert names == sorted(AUDITABLE_TABLES)
    assert names == sorted(names)


def test_admin_web_auditable_tables_match() -> None:
    text = (
        _REPO_ROOT / "apps" / "admin_web" / "src" / "types" / "audit-log.ts"
    ).read_text(encoding="utf-8")
    start = text.index("export const AUDITABLE_AUDIT_LOG_TABLES")
    block = text[start:]
    names: list[str] = []
    for line in block.splitlines():
        stripped = line.strip()
        if stripped.startswith("'") and stripped.endswith("',"):
            names.append(stripped[1:-2])
        elif stripped.startswith("'") and stripped.endswith("'"):
            names.append(stripped[1:-1])
        if stripped == "] as const;":
            break
    assert names == sorted(AUDITABLE_TABLES)
