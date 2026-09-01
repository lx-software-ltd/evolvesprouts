"""Tests for Graph conversation history mapping."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.db.models.enums import MetaChannel, MetaMessageDirection
from app.services import meta_history_sync as sync


def test_sync_maps_graph_conversation_without_leads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: list[object] = []
    calls: list[tuple[str, dict[str, str] | None]] = []

    def _store(_session: object, **kwargs: object) -> None:
        stored.append(kwargs)
        counters = kwargs["counters"]
        if isinstance(counters, dict):
            counters["stored"] = int(counters.get("stored") or 0) + 1

    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        calls.append((path, params))
        assert token == "page-token"
        if path == "page-1/conversations":
            assert params is not None
            assert "messages" not in str(params.get("fields") or "")
            assert params.get("limit") == "15"
            return {
                "data": [
                    {
                        "id": "conv-1",
                        "participants": {
                            "data": [
                                {"id": "page-1", "name": "Page"},
                                {"id": "igsid-9", "username": "kitie"},
                            ]
                        },
                    }
                ]
            }
        if path == "conv-1/messages":
            assert params is not None
            assert params.get("limit") == "20"
            assert "attachments" not in str(params.get("fields") or "")
            return {
                "data": [
                    {
                        "id": "m_old",
                        "created_time": "2026-01-02T03:04:05+0000",
                        "from": {"id": "igsid-9", "username": "kitie"},
                        "message": "Hello from IG",
                    },
                    {
                        "id": "m_echo",
                        "created_time": "2026-01-02T03:05:05+0000",
                        "from": {"id": "ig-biz-1"},
                        "message": "Hi back",
                    },
                ]
            }
        raise AssertionError(f"unexpected Graph path {path}")

    monkeypatch.setenv("META_PAGE_ID", "page-1")
    monkeypatch.setenv("META_INSTAGRAM_USER_ID", "ig-biz-1")
    monkeypatch.setattr(sync, "resolve_page_access_token", lambda: "page-token")
    monkeypatch.setattr(sync, "store_meta_message", _store)
    monkeypatch.setattr(sync, "graph_get", _graph_get)

    counters = sync.sync_meta_channel_history(SimpleNamespace(), MetaChannel.INSTAGRAM)
    assert [path for path, _params in calls] == [
        "page-1/conversations",
        "conv-1/messages",
    ]
    assert counters["conversations"] == 1
    assert counters["stored"] == 2
    assert stored[0]["create_leads"] is False
    assert stored[0]["platform_user_id"] == "igsid-9"
    assert stored[0]["direction"] is MetaMessageDirection.INBOUND
    assert stored[1]["direction"] is MetaMessageDirection.OUTBOUND
