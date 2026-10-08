#!/usr/bin/env python3
"""Fail when first-party Python files grow past 500 lines.

Files already over the limit are listed in
``scripts/python-file-length-allowlist.txt`` with their current line count.
A listed file may not grow. Shrinking a listed file requires lowering its
allowance in the same change. Dropping to 500 lines or fewer requires
removing the entry. Alembic revision files are exempt.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST_PATH = ROOT / "scripts" / "python-file-length-allowlist.txt"
LIMIT = 500

SCAN_ROOTS = (
    ROOT / "backend" / "src",
    ROOT / "backend" / "lambda",
    ROOT / "backend" / "scripts",
    ROOT / "backend" / "db",
    ROOT / "tests",
    ROOT / "scripts",
)


def line_count(path: Path) -> int:
    return len(path.read_text(encoding="utf-8").splitlines())


def is_exempt(path: Path) -> bool:
    parts = path.parts
    if "alembic" not in parts:
        return False
    alembic_at = parts.index("alembic")
    return alembic_at + 1 < len(parts) and parts[alembic_at + 1] == "versions"


def iter_python_files() -> list[Path]:
    files: list[Path] = []
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*.py"):
            if is_exempt(path):
                continue
            if any(part.startswith(".") for part in path.parts):
                continue
            files.append(path)
    return files


def load_allowlist() -> dict[str, int]:
    allowed: dict[str, int] = {}
    if not ALLOWLIST_PATH.exists():
        return allowed
    for line_number, raw in enumerate(
        ALLOWLIST_PATH.read_text(encoding="utf-8").splitlines(), start=1
    ):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            rel_path, count_text = line.rsplit(None, 1)
            count = int(count_text)
        except ValueError as exc:
            raise SystemExit(
                f"{ALLOWLIST_PATH}:{line_number}: expected '<path> <lines>'"
            ) from exc
        if count <= LIMIT:
            raise SystemExit(
                f"{ALLOWLIST_PATH}:{line_number}: {rel_path} allowance {count} is not above {LIMIT}; remove it"
            )
        if rel_path in allowed:
            raise SystemExit(
                f"{ALLOWLIST_PATH}:{line_number}: duplicate entry for {rel_path}"
            )
        allowed[rel_path] = count
    return allowed


def main() -> int:
    allowed = load_allowlist()
    errors: list[str] = []
    seen: set[str] = set()
    for path in iter_python_files():
        rel = path.relative_to(ROOT).as_posix()
        seen.add(rel)
        count = line_count(path)
        allowance = allowed.get(rel)
        if count <= LIMIT:
            if allowance is not None:
                errors.append(f"{rel} is {count} lines; remove it from the allowlist")
            continue
        if allowance is None:
            errors.append(
                f"{rel} is {count} lines (limit {LIMIT}); split it or, if it already exists, allowlist {count}"
            )
        elif count > allowance:
            errors.append(f"{rel} grew from {allowance} to {count} lines")
        elif count < allowance:
            errors.append(
                f"{rel} shrank from {allowance} to {count} lines; lower its allowlist entry"
            )
    for rel in sorted(set(allowed) - seen):
        errors.append(f"{rel} is allowlisted but was not found")
    if errors:
        print("Python file length check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Python file length check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
