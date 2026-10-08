#!/usr/bin/env python3
"""Reject focused or unconditionally skipped tests.

Conditional skips (``pytest.mark.skipif``, ``pytest.skip``) stay allowed.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SEARCH_ROOTS = (
    ROOT / "tests",
    ROOT / "apps" / "admin_web" / "tests",
    ROOT / "apps" / "public_www" / "tests",
    ROOT / "apps" / "training" / "tests",
    ROOT / "apps" / "evolvesprouts_app" / "test",
    ROOT / "packages",
    ROOT / "backend" / "infrastructure" / "test",
)

JS_PATTERN = re.compile(
    r"(\.only\s*\(|\bfit\s*\(|\bfdescribe\s*\(|\bxit\s*\(|\bxdescribe\s*\(|"
    r"\bdescribe\.skip\s*\(|\bit\.skip\s*\(|\btest\.skip\s*\(|\bcontext\.skip\s*\()"
)
PY_SKIP_PATTERN = re.compile(r"@pytest\.mark\.skip\b(?!if)")
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".dart"}


def iter_files() -> list[Path]:
    files: list[Path] = []
    for root in SEARCH_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
                continue
            if "node_modules" in path.parts:
                continue
            files.append(path)
    return files


def main() -> int:
    errors: list[str] = []
    for path in iter_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(ROOT).as_posix()
        for line_number, line in enumerate(text.splitlines(), start=1):
            if JS_PATTERN.search(line):
                errors.append(
                    f"{rel}:{line_number}: focused or skipped test: {line.strip()}"
                )
            if path.suffix == ".py" and PY_SKIP_PATTERN.search(line):
                errors.append(
                    f"{rel}:{line_number}: unconditional pytest skip: {line.strip()}"
                )
    if errors:
        print("Test focus check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Test focus check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
