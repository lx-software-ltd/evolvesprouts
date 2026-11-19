"""Tests for Page subscribed_apps detect-and-repair."""

from __future__ import annotations

import pytest
from app.services import meta_page_subscription as sub
from app.services.meta_graph_client import MetaGraphApiError


def test_ensure_subscription_ok_when_messages_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    posts: list[object] = []

    def _graph_get(path: str, *, params=None, token=None):
        assert path == "page-1/subscribed_apps"
        assert token == "page-token"
        return {
            "data": [
                {
                    "id": "app-1",
                    "subscribed_fields": ["feed", "messages", "message_echoes"],
                }
            ]
        }

    monkeypatch.setattr(sub, "graph_get", _graph_get)
    monkeypatch.setattr(
        sub, "graph_post", lambda *args, **kwargs: posts.append((args, kwargs)) or {}
    )

    result = sub.ensure_page_messages_subscription(page_id="page-1", token="page-token")
    assert result == {"subscription_ok": 1}
    assert posts == []


def test_ensure_subscription_repairs_when_messages_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    posts: list[tuple[object, object]] = []

    def _graph_get(path: str, *, params=None, token=None):
        return {"data": [{"id": "app-1", "subscribed_fields": ["feed"]}]}

    def _graph_post(path: str, *, params=None, token=None):
        posts.append((path, params, token))
        return {"success": True}

    monkeypatch.setattr(sub, "graph_get", _graph_get)
    monkeypatch.setattr(sub, "graph_post", _graph_post)

    result = sub.ensure_page_messages_subscription(page_id="page-1", token="page-token")
    assert result == {"subscription_repaired": 1}
    assert posts == [
        (
            "page-1/subscribed_apps",
            {"subscribed_fields": "messages"},
            "page-token",
        )
    ]


def test_ensure_subscription_failure_is_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _graph_get(path: str, *, params=None, token=None):
        raise MetaGraphApiError(status_code=500, message="boom")

    monkeypatch.setattr(sub, "graph_get", _graph_get)

    result = sub.ensure_page_messages_subscription(page_id="page-1", token="page-token")
    assert result == {"subscription_failed": 1}
