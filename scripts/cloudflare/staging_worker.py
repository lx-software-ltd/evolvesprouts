#!/usr/bin/env python3
"""Upload the staging allow-list Worker and attach its route.

The Worker source is ``workers/www-staging-redirect-allowlist.js``. The
allow-list and the production origin are plain-text bindings; the bypass
and edge-verify values are secret bindings. When a secret environment
variable is unset the secret already on the Worker is kept, so rotating
one value never clears the other.

Environment:
    CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   required
    STAGING_ALLOWED_IPS                           required, comma separated
    STAGING_BYPASS_SECRET                         optional secret
    PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET         optional secret

    python3 scripts/cloudflare/staging_worker.py \\
        --name <worker-name> \\
        --zone example.com --route 'www-staging.example.com/*' \\
        --production-origin https://www.example.com --yes

Plan: docs/plans/api-domain-staging-gate.md
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any

API_BASE = "https://api.cloudflare.com/client/v4"
SOURCE = Path(__file__).with_name("workers") / "www-staging-redirect-allowlist.js"
MAIN_MODULE = "worker.js"
COMPATIBILITY_DATE = "2026-11-01"
SECRET_BINDINGS = ("STAGING_BYPASS_SECRET", "PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET")


class WorkerError(Exception):
    """Invalid input or a Cloudflare API failure."""


def parse_allowed_ips(raw: str) -> list[str]:
    """Return public IPs from ``raw``; private ranges can never be CF-Connecting-IP."""
    result: list[str] = []
    for value in raw.replace("\n", ",").replace(" ", ",").split(","):
        value = value.strip()
        if not value:
            continue
        try:
            address = ipaddress.ip_address(value)
        except ValueError as error:
            raise WorkerError(f"not an IP address: {value!r}") from error
        if not address.is_global:
            continue
        if value not in result:
            result.append(value)
    if not result:
        raise WorkerError("STAGING_ALLOWED_IPS has no public addresses")
    return result


def build_metadata(
    production_origin: str, allowed_ips: list[str], environ: Mapping[str, str]
) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(production_origin)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path not in ("", "/"):
        raise WorkerError("--production-origin must be https://host with no path")
    bindings: list[dict[str, str]] = [
        {"type": "plain_text", "name": "PRODUCTION_ORIGIN", "text": production_origin},
        {
            "type": "plain_text",
            "name": "STAGING_ALLOWED_IPS",
            "text": ",".join(allowed_ips),
        },
    ]
    for name in SECRET_BINDINGS:
        value = environ.get(name, "").strip()
        if value:
            bindings.append({"type": "secret_text", "name": name, "text": value})
    return {
        "main_module": MAIN_MODULE,
        "compatibility_date": COMPATIBILITY_DATE,
        "bindings": bindings,
        "keep_bindings": ["secret_text"],
    }


def _call(
    token: str, method: str, path: str, body: bytes | None, content_type: str
) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{API_BASE}{path}",
        data=body,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        payload = json.loads(error.read().decode("utf-8") or "{}")
    if not payload.get("success", False):
        messages = [
            str(item.get("message", item)) for item in payload.get("errors", [])
        ]
        raise WorkerError(f"{method} {path}: {'; '.join(messages) or 'failed'}")
    return payload


def _json(token: str, method: str, path: str, body: Any = None) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    return _call(token, method, path, data, "application/json")


def upload(token: str, account: str, name: str, metadata: dict[str, Any]) -> None:
    boundary = uuid.uuid4().hex
    parts = [
        (
            (
                'Content-Disposition: form-data; name="metadata"\r\n'
                "Content-Type: application/json\r\n\r\n"
            ),
            json.dumps(metadata).encode("utf-8"),
        ),
        (
            (
                f'Content-Disposition: form-data; name="{MAIN_MODULE}"; '
                f'filename="{MAIN_MODULE}"\r\n'
                "Content-Type: application/javascript+module\r\n\r\n"
            ),
            SOURCE.read_bytes(),
        ),
    ]
    body = b""
    for header, content in parts:
        body += f"--{boundary}\r\n{header}".encode() + content + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    _call(
        token,
        "PUT",
        f"/accounts/{account}/workers/scripts/{name}",
        body,
        f"multipart/form-data; boundary={boundary}",
    )


def ensure_route(token: str, zone: str, pattern: str, name: str) -> str:
    zones = _json(token, "GET", f"/zones?name={urllib.parse.quote(zone)}")["result"]
    if not zones:
        raise WorkerError(f"zone {zone} not found")
    zone_id = zones[0]["id"]
    routes = _json(token, "GET", f"/zones/{zone_id}/workers/routes")["result"]
    for route in routes:
        if route.get("pattern") == pattern:
            if route.get("script") == name:
                return "unchanged"
            _json(
                token,
                "PUT",
                f"/zones/{zone_id}/workers/routes/{route['id']}",
                {"pattern": pattern, "script": name},
            )
            return "updated"
    _json(
        token,
        "POST",
        f"/zones/{zone_id}/workers/routes",
        {"pattern": pattern, "script": name},
    )
    return "created"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--name", required=True)
    parser.add_argument("--zone", required=True)
    parser.add_argument("--route", required=True)
    parser.add_argument("--production-origin", required=True)
    parser.add_argument("--yes", action="store_true", help="Required to write.")
    args = parser.parse_args(argv)

    try:
        token = os.environ["CLOUDFLARE_API_TOKEN"]
        account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    except KeyError as error:
        print(f"missing environment variable {error}", file=sys.stderr)
        return 2
    try:
        ips = parse_allowed_ips(os.environ.get("STAGING_ALLOWED_IPS", ""))
        metadata = build_metadata(args.production_origin, ips, os.environ)
        print(f"worker {args.name}: {len(ips)} allowed IPs")
        if not args.yes:
            print("dry run; pass --yes to upload and attach the route")
            return 0
        upload(token, account, args.name, metadata)
        print(
            f"route {args.route}: {ensure_route(token, args.zone, args.route, args.name)}"
        )
    except WorkerError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
