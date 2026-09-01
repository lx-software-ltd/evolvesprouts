"""Tests for Meta Graph HTTP client error handling."""

from __future__ import annotations

import json

import pytest

from app.services import meta_graph_client as client
from app.services.meta_graph_client import MetaGraphApiError


def test_graph_get_401_hints_page_token_not_verify_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("META_PAGE_ACCESS_TOKEN", "handshake-string")

    def _fake_http_invoke(**_kwargs: object) -> dict[str, object]:
        return {
            "status": 401,
            "body": json.dumps(
                {
                    "error": {
                        "message": "Invalid OAuth access token - Cannot parse access token"
                    }
                }
            ),
        }

    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)

    with pytest.raises(MetaGraphApiError) as exc_info:
        client.graph_get("me")

    assert exc_info.value.status_code == 401
    message = str(exc_info.value)
    assert "Cannot parse access token" in message
    assert "webhook verify string" in message
