"""Unlisted methods on partner paths return 405."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.api.admin import lambda_handler

_PARTNER_YAML = Path(__file__).resolve().parents[1] / "docs" / "api" / "partner.yaml"
_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")
_PARAM = re.compile(r"\{([^{}]+)\}")


def _partner_routes() -> dict[str, set[str]]:
    routes: dict[str, set[str]] = {}
    current: str | None = None
    in_paths = False
    for raw in _PARTNER_YAML.read_text(encoding="utf-8").splitlines():
        if raw.startswith("paths:"):
            in_paths = True
            continue
        if not in_paths:
            continue
        if raw.startswith("components:"):
            break
        path_match = re.match(r"^  (/[^:]+):\s*$", raw)
        if path_match:
            current = path_match.group(1)
            routes[current] = set()
            continue
        if current is None:
            continue
        method_match = re.match(r"^    ([a-z]+):\s*$", raw)
        if method_match and method_match.group(1).upper() in _METHODS:
            routes[current].add(method_match.group(1).upper())
    return routes


def _concrete_path(path: str) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in {"id", "note_id", "member_id", "instance_id"}:
            return str(uuid4())
        return "example"

    return _PARAM.sub(replace, path)


def test_unlisted_partner_method_returns_405(api_gateway_event: Any) -> None:
    routes = _partner_routes()
    assert routes
    key_id = str(uuid4())
    for path, methods in routes.items():
        missing = next(method for method in _METHODS if method not in methods)
        concrete = _concrete_path(path)
        event = api_gateway_event(
            method=missing,
            path=concrete,
            authorizer_context={
                "apiKeyId": key_id,
                "scope": "admin",
                "userSub": f"api-key:{key_id}",
            },
        )
        response = lambda_handler(event, None)
        assert response["statusCode"] == 405, f"{missing} {concrete}"
