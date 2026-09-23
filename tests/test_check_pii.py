"""Normalization rules for the hashed personal-data check."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "check_pii.py"
_SPEC = importlib.util.spec_from_file_location("check_pii", _MODULE_PATH)
assert _SPEC is not None and _SPEC.loader is not None
check_pii = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_pii)


def test_trailing_period_does_not_stick_to_name_tokens() -> None:
    candidates = check_pii._candidates("Hello Sam Rivera.")
    assert "sam rivera" in candidates
    assert "rivera" in candidates
    assert "sam rivera." not in candidates
    assert "rivera." not in candidates


def test_email_trailing_period_is_stripped_from_tokens() -> None:
    candidates = check_pii._candidates("Write user@example.com.")
    assert "user@example.com" in candidates
    assert "user@example.com." not in candidates


def test_interior_dots_stay_in_tokens() -> None:
    candidates = check_pii._candidates("See note.v2 today.")
    assert "note.v2" in candidates


def test_handle_strips_at_sign_and_trailing_period() -> None:
    candidates = check_pii._candidates("Follow @Mei.C.")
    assert "mei.c" in candidates
    assert "@mei.c" not in candidates
    assert "mei.c." not in candidates


def test_scan_suffixes_cover_source_docs_and_styles() -> None:
    assert {
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".dart",
        ".sql",
        ".md",
        ".mdc",
        ".yml",
        ".yaml",
        ".sh",
        ".html",
        ".css",
    } <= check_pii.SCAN_SUFFIXES
