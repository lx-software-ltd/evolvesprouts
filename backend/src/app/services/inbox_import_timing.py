"""Shared stale-window helpers for inbox import jobs."""

from __future__ import annotations

import os
from datetime import timedelta


def inbox_import_lambda_timeout_seconds() -> int:
    """Lambda timeout used for stale pending/processing detection."""
    raw = os.environ.get("INBOX_IMPORT_LAMBDA_TIMEOUT_SECONDS", "600").strip()
    try:
        return max(60, int(raw))
    except ValueError:
        return 600


def inbox_import_stale_threshold() -> timedelta:
    """Age after which a pending/processing job is no longer treated as in flight."""
    return timedelta(seconds=inbox_import_lambda_timeout_seconds() * 2 + 120)
