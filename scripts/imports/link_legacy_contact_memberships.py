#!/usr/bin/env python3
"""Shim — use ``import_legacy_crm.py link_contact_memberships`` instead.

Kept for back-compat with earlier one-off runbooks. The membership-backfill
operation is a first-class importer entity (``link_contact_memberships``).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent / "import_legacy_crm.py"


def main() -> int:
    print(
        "link_legacy_contact_memberships.py is deprecated; use "
        f"python {_SCRIPT.name} link_contact_memberships <sql_path> [--dry-run]",
        file=sys.stderr,
    )
    argv = [sys.executable, str(_SCRIPT), "link_contact_memberships", *sys.argv[1:]]
    return subprocess.call(argv)


if __name__ == "__main__":
    raise SystemExit(main())
