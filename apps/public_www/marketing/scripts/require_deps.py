"""Fail fast with an install hint when a marketing-script dependency is missing.

The Ads / GA4 scripts import the ``google.*`` namespace. That comes from
``scripts/requirements.txt`` (``google-ads``, ``google-analytics-*``,
``google-auth``), not from the unrelated PyPI package named ``google``.

Alpine Linux (musl, PEP 668) cannot ``pip install`` into the system
interpreter, which is why a raw ``python3 …py`` there raises
``ModuleNotFoundError: google``.
"""

from __future__ import annotations

import sys

HINT = """The Google client libraries are not installed in this Python.

From apps/public_www/marketing, use a venv (required on Alpine / PEP 668):

    python3 -m venv .venv
    . .venv/bin/activate
    python -m pip install -U pip
    python -m pip install -r scripts/requirements.txt

On Alpine, install the venv module first:

    apk add --no-cache python3 py3-pip py3-virtualenv

If pip then tries to compile grpcio (no musllinux wheel), also:

    apk add --no-cache gcc g++ musl-dev linux-headers python3-dev

Do not `pip install google` — that is a different, unrelated package.
"""


def exit_missing_google(exc: BaseException) -> None:
    name = getattr(exc, "name", None) or "google"
    sys.stderr.write(f"ModuleNotFoundError: {name}\n\n{HINT}")
    raise SystemExit(2) from exc
