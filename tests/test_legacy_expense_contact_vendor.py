"""Contact-person vendor matching for the historical expense cleanup."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "backend/db/alembic/versions/0016_delete_expenses_missing_vendor.py"
)
_SPEC = importlib.util.spec_from_file_location("migration_0016", _MODULE_PATH)
assert _SPEC is not None and _SPEC.loader is not None
migration_0016 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(migration_0016)


def test_configured_name_is_bound_and_not_interpolated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        migration_0016.LEGACY_CONTACT_VENDOR_ENV,
        "Contact Person: Example Client",
    )
    clause, params = migration_0016.contact_vendor_predicate("e.vendor_name")
    assert clause == "trim(e.vendor_name) = :legacy_contact_vendor_name"
    assert params == {"legacy_contact_vendor_name": "Contact Person: Example Client"}
    assert "Example Client" not in clause


def test_unset_name_matches_the_contact_person_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(migration_0016.LEGACY_CONTACT_VENDOR_ENV, raising=False)
    clause, params = migration_0016.contact_vendor_predicate("tgt.vendor_name")
    assert clause == "trim(tgt.vendor_name) LIKE 'Contact Person:%'"
    assert params == {}


def test_blank_name_matches_the_contact_person_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(migration_0016.LEGACY_CONTACT_VENDOR_ENV, "   ")
    clause, params = migration_0016.contact_vendor_predicate("e.vendor_name")
    assert clause == "trim(e.vendor_name) LIKE 'Contact Person:%'"
    assert params == {}


def test_unknown_column_is_rejected() -> None:
    with pytest.raises(ValueError, match="unsupported vendor column"):
        migration_0016.contact_vendor_predicate("vendor_name")
