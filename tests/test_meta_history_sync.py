"""Tests for Graph conversation history mapping."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.db.models.enums import MetaChannel, MetaMessageDirection
from app.services import meta_history_sync as sync
from app.services.meta_graph_client import MetaGraphApiError


def _store_capturing(stored: list[object]):
    def _store(_session: object, **kwargs: object) -> None:
        stored.append(kwargs)
        counters = kwargs["counters"]
        if isinstance(counters, dict):
            counters["stored"] = int(counters.get("stored") or 0) + 1

    return _store


@pytest.fixture(autouse=True)
def _stub_page_subscription(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        sync,
        "ensure_page_messages_subscription",
        lambda **_kwargs: {"subscription_ok": 1},
    )


def _with_page_lookup(handler):
    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        try:
            return handler(path, params=params, token=token)
        except AssertionError:
            if path == "page-1":
                return {"id": "page-1"}
            raise

    return _graph_get


def test_sync_without_instagram_user_id_treats_business_participant_as_self(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Business-then-customer participants still store the customer thread."""
    stored: list[object] = []
    calls: list[tuple[str, dict[str, str] | None]] = []

    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        calls.append((path, params))
        assert token == "page-token"
        if path == "page-1":
            return {"id": "page-1"}
        if path == "page-1/conversations":
            return {
                "data": [
                    {
                        "id": "conv-1",
                        "participants": {
                            "data": [
                                {"id": "ig-biz-1", "username": "evolvesprouts"},
                                {"id": "igsid-9", "username": "mei"},
                            ]
                        },
                    }
                ]
            }
        if path == "conv-1/messages":
            return {
                "data": [
                    {
                        "id": "m_in",
                        "created_time": "2026-01-02T03:04:05+0000",
                        "from": {"id": "igsid-9", "username": "mei"},
                        "message": "Hello from customer",
                    },
                    {
                        "id": "m_out",
                        "created_time": "2026-01-02T03:05:05+0000",
                        "from": {"id": "ig-biz-1", "username": "evolvesprouts"},
                        "message": "Hi back",
                    },
                ]
            }
        raise AssertionError(f"unexpected Graph path {path}")

    monkeypatch.setenv("META_PAGE_ID", "page-1")
    monkeypatch.delenv("META_INSTAGRAM_USER_ID", raising=False)
    monkeypatch.setenv(
        "NEXT_PUBLIC_INSTAGRAM_URL", "https://www.instagram.com/evolvesprouts"
    )
    monkeypatch.delenv("PUBLIC_WWW_INSTAGRAM_URL", raising=False)
    monkeypatch.setattr(sync, "resolve_page_access_token", lambda: "page-token")
    monkeypatch.setattr(sync, "store_meta_message", _store_capturing(stored))
    monkeypatch.setattr(sync, "graph_get", _with_page_lookup(_graph_get))
    monkeypatch.setattr(
        sync,
        "ensure_page_messages_subscription",
        lambda **_kwargs: {"subscription_ok": 1},
    )

    counters = sync.sync_meta_channel_history(SimpleNamespace(), MetaChannel.INSTAGRAM)
    assert ("page-1", {"fields": "instagram_business_account"}) in calls
    assert counters["conversations"] == 1
    assert counters["stored"] == 2
    assert stored[0]["create_leads"] is False
    assert stored[0]["platform_user_id"] == "igsid-9"
    assert stored[0]["direction"] is MetaMessageDirection.INBOUND
    assert stored[1]["direction"] is MetaMessageDirection.OUTBOUND
    assert stored[1]["platform_user_id"] == "igsid-9"


def test_incremental_sync_stops_at_channel_watermark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Newest-first conversations stop once updated_time is at the watermark."""
    from datetime import UTC, datetime

    stored: list[object] = []
    calls: list[str] = []

    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        calls.append(path)
        if path == "page-1/conversations":
            assert params is not None
            assert "updated_time" in str(params.get("fields") or "")
            return {
                "data": [
                    {
                        "id": "conv-new",
                        "updated_time": "2026-03-02T12:00:00+0000",
                        "participants": {
                            "data": [
                                {"id": "page-1"},
                                {"id": "user-new", "name": "New"},
                            ]
                        },
                    },
                    {
                        "id": "conv-old",
                        "updated_time": "2026-03-01T08:00:00+0000",
                        "participants": {
                            "data": [
                                {"id": "page-1"},
                                {"id": "user-old", "name": "Old"},
                            ]
                        },
                    },
                ],
                "paging": {"cursors": {"after": "more"}},
            }
        if path == "conv-new/messages":
            return {
                "data": [
                    {
                        "id": "m_new",
                        "created_time": "2026-03-02T12:00:00+0000",
                        "from": {"id": "user-new"},
                        "message": "fresh",
                    },
                    {
                        "id": "m_seen",
                        "created_time": "2026-03-01T09:00:00+0000",
                        "from": {"id": "user-new"},
                        "message": "already stored era",
                    },
                ]
            }
        if path == "conv-old/messages":
            raise AssertionError("old conversation should not be fetched")
        raise AssertionError(f"unexpected Graph path {path}")

    monkeypatch.setenv("META_PAGE_ID", "page-1")
    monkeypatch.setattr(sync, "resolve_page_access_token", lambda: "page-token")
    monkeypatch.setattr(sync, "store_meta_message", _store_capturing(stored))
    monkeypatch.setattr(sync, "graph_get", _with_page_lookup(_graph_get))
    monkeypatch.setattr(
        sync,
        "_channel_watermark",
        lambda _session, _channel: datetime(2026, 3, 1, 10, 0, tzinfo=UTC),
    )

    counters = sync.sync_meta_channel_history(
        SimpleNamespace(),
        MetaChannel.FACEBOOK,
        incremental=True,
    )
    assert counters["conversations"] == 1
    assert counters["stored"] == 1
    assert stored[0]["create_leads"] is False
    assert stored[0]["platform_user_id"] == "user-new"
    assert "conv-old/messages" not in calls
    assert counters.get("stopped_at_watermark") == 1


def test_sync_continues_when_subscription_check_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: list[object] = []

    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        if path == "page-1/conversations":
            return {
                "data": [
                    {
                        "id": "conv-1",
                        "participants": {
                            "data": [
                                {"id": "page-1"},
                                {"id": "user-1", "name": "A"},
                            ]
                        },
                    }
                ]
            }
        if path == "conv-1/messages":
            return {
                "data": [
                    {
                        "id": "m1",
                        "created_time": "2026-01-02T03:04:05+0000",
                        "from": {"id": "user-1"},
                        "message": "hi",
                    }
                ]
            }
        raise AssertionError(f"unexpected Graph path {path}")

    monkeypatch.setenv("META_PAGE_ID", "page-1")
    monkeypatch.setattr(sync, "resolve_page_access_token", lambda: "page-token")
    monkeypatch.setattr(sync, "store_meta_message", _store_capturing(stored))
    monkeypatch.setattr(sync, "graph_get", _with_page_lookup(_graph_get))
    monkeypatch.setattr(
        sync,
        "ensure_page_messages_subscription",
        lambda **_kwargs: {"subscription_failed": 1},
    )

    counters = sync.sync_meta_channel_history(SimpleNamespace(), MetaChannel.FACEBOOK)
    assert counters["subscription_failed"] == 1
    assert counters["stored"] == 1
    assert stored[0]["platform_user_id"] == "user-1"


def test_sync_maps_graph_conversation_without_leads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: list[object] = []
    calls: list[tuple[str, dict[str, str] | None]] = []

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
            assert "participants.limit(5)" in str(params.get("fields") or "")
            assert params.get("limit") == "5"
            return {
                "data": [
                    {
                        "id": "conv-1",
                        "participants": {
                            "data": [
                                {"id": "page-1", "name": "Page"},
                                {"id": "igsid-9", "username": "mei"},
                            ]
                        },
                    }
                ]
            }
        if path == "conv-1/messages":
            assert params is not None
            assert params.get("limit") == "5"
            assert "from{id,name,username}" in str(params.get("fields") or "")
            return {
                "data": [
                    {
                        "id": "m_old",
                        "created_time": "2026-01-02T03:04:05+0000",
                        "from": {"id": "igsid-9", "username": "mei"},
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
    monkeypatch.setattr(sync, "store_meta_message", _store_capturing(stored))
    monkeypatch.setattr(sync, "graph_get", _with_page_lookup(_graph_get))

    counters = sync.sync_meta_channel_history(SimpleNamespace(), MetaChannel.INSTAGRAM)
    assert [path for path, _params in calls] == [
        "page-1",
        "page-1/conversations",
        "conv-1/messages",
    ]
    assert counters["conversations"] == 1
    assert counters["stored"] == 2
    assert counters["subscription_ok"] == 1
    assert stored[0]["create_leads"] is False
    assert stored[0]["platform_user_id"] == "igsid-9"
    assert stored[0]["instagram_handle"] == "mei"
    assert stored[0]["direction"] is MetaMessageDirection.INBOUND
    assert stored[1]["direction"] is MetaMessageDirection.OUTBOUND
    assert stored[1]["instagram_handle"] == "mei"


def test_counterparty_splits_display_name_from_username() -> None:
    user_id, profile, handle = sync._counterparty(
        {
            "participants": {
                "data": [
                    {"id": "page-1", "name": "Page"},
                    {
                        "id": "igsid-9",
                        "name": "Feier Wang",
                        "username": "@Mei.C",
                    },
                ]
            }
        },
        self_ids={"page-1"},
    )
    assert user_id == "igsid-9"
    assert profile == "Feier Wang"
    assert handle == "mei.c"


def test_sync_skips_own_instagram_handle_conversation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: list[object] = []

    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        if path == "page-1/conversations":
            return {
                "data": [
                    {
                        "id": "conv-self",
                        "participants": {
                            "data": [
                                {"id": "page-1"},
                                {"id": "igsid-self", "username": "evolvesprouts"},
                            ]
                        },
                    },
                    {
                        "id": "conv-1",
                        "participants": {
                            "data": [
                                {"id": "page-1"},
                                {"id": "igsid-9", "username": "mei"},
                            ]
                        },
                    },
                ]
            }
        if path == "conv-1/messages":
            return {
                "data": [
                    {
                        "id": "m_ok",
                        "created_time": "2026-01-02T03:04:05+0000",
                        "from": {"id": "igsid-9", "username": "mei"},
                        "message": "Hello",
                    }
                ]
            }
        raise AssertionError(f"unexpected Graph path {path}")

    monkeypatch.setenv("META_PAGE_ID", "page-1")
    monkeypatch.setenv(
        "NEXT_PUBLIC_INSTAGRAM_URL", "https://www.instagram.com/evolvesprouts"
    )
    monkeypatch.delenv("PUBLIC_WWW_INSTAGRAM_URL", raising=False)
    monkeypatch.setattr(sync, "resolve_page_access_token", lambda: "page-token")
    monkeypatch.setattr(sync, "store_meta_message", _store_capturing(stored))
    monkeypatch.setattr(sync, "graph_get", _with_page_lookup(_graph_get))

    counters = sync.sync_meta_channel_history(SimpleNamespace(), MetaChannel.INSTAGRAM)
    assert counters["skipped"] >= 1
    assert counters["conversations"] == 1
    assert counters["stored"] == 1
    assert stored[0]["platform_user_id"] == "igsid-9"


def test_sync_skips_own_handle_when_participant_has_display_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: list[object] = []

    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        if path == "page-1/conversations":
            return {
                "data": [
                    {
                        "id": "conv-self",
                        "participants": {
                            "data": [
                                {"id": "page-1"},
                                {
                                    "id": "igsid-self",
                                    "name": "Evolve Sprouts",
                                    "username": "evolvesprouts",
                                },
                            ]
                        },
                    }
                ]
            }
        raise AssertionError(f"unexpected Graph path {path}")

    monkeypatch.setenv("META_PAGE_ID", "page-1")
    monkeypatch.setenv(
        "NEXT_PUBLIC_INSTAGRAM_URL", "https://www.instagram.com/evolvesprouts"
    )
    monkeypatch.delenv("PUBLIC_WWW_INSTAGRAM_URL", raising=False)
    monkeypatch.setattr(sync, "resolve_page_access_token", lambda: "page-token")
    monkeypatch.setattr(sync, "store_meta_message", _store_capturing(stored))
    monkeypatch.setattr(sync, "graph_get", _with_page_lookup(_graph_get))

    counters = sync.sync_meta_channel_history(SimpleNamespace(), MetaChannel.INSTAGRAM)
    assert counters["skipped"] >= 1
    assert counters["conversations"] == 0
    assert stored == []


def test_sync_retries_conversation_list_with_smaller_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    limits: list[str] = []

    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        assert token == "page-token"
        if path == "page-1/conversations":
            limit = str((params or {}).get("limit") or "")
            limits.append(limit)
            if limit == "5":
                raise MetaGraphApiError(
                    status_code=500,
                    message="Please reduce the amount of data you're asking for",
                )
            return {
                "data": [
                    {
                        "id": "conv-1",
                        "participants": {
                            "data": [
                                {"id": "page-1"},
                                {"id": "igsid-9", "username": "mei"},
                            ]
                        },
                    }
                ]
            }
        if path == "conv-1/messages":
            return {"data": []}
        raise AssertionError(f"unexpected Graph path {path}")

    monkeypatch.setenv("META_PAGE_ID", "page-1")
    monkeypatch.setattr(sync, "resolve_page_access_token", lambda: "page-token")
    monkeypatch.setattr(sync, "store_meta_message", _store_capturing([]))
    monkeypatch.setattr(sync, "graph_get", _with_page_lookup(_graph_get))

    counters = sync.sync_meta_channel_history(SimpleNamespace(), MetaChannel.INSTAGRAM)
    assert limits == ["5", "2"]
    assert counters["conversations"] == 1


def test_sync_skips_conversation_when_messages_still_too_large(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: list[object] = []

    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        if path == "page-1/conversations":
            return {
                "data": [
                    {
                        "id": "conv-ok",
                        "participants": {
                            "data": [{"id": "page-1"}, {"id": "user-1", "name": "A"}]
                        },
                    },
                    {
                        "id": "conv-fat",
                        "participants": {
                            "data": [{"id": "page-1"}, {"id": "user-2", "name": "B"}]
                        },
                    },
                ]
            }
        if path == "conv-ok/messages":
            return {
                "data": [
                    {
                        "id": "m1",
                        "created_time": "2026-01-02T03:04:05+0000",
                        "from": {"id": "user-1"},
                        "message": "hi",
                    }
                ]
            }
        if path == "conv-fat/messages":
            raise MetaGraphApiError(
                status_code=500,
                message="Please reduce the amount of data you're asking for",
            )
        raise AssertionError(f"unexpected Graph path {path}")

    monkeypatch.setenv("META_PAGE_ID", "page-1")
    monkeypatch.setattr(sync, "resolve_page_access_token", lambda: "page-token")
    monkeypatch.setattr(sync, "store_meta_message", _store_capturing(stored))
    monkeypatch.setattr(sync, "graph_get", _with_page_lookup(_graph_get))

    counters = sync.sync_meta_channel_history(SimpleNamespace(), MetaChannel.FACEBOOK)
    assert counters["stored"] == 1
    assert counters["skipped"] >= 1
    assert stored[0]["platform_user_id"] == "user-1"


def test_sync_skips_conversation_on_proxy_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: list[object] = []

    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        if path == "page-1/conversations":
            return {
                "data": [
                    {
                        "id": "conv-ok",
                        "participants": {
                            "data": [{"id": "page-1"}, {"id": "user-1", "name": "A"}]
                        },
                    },
                    {
                        "id": "conv-slow",
                        "participants": {
                            "data": [{"id": "page-1"}, {"id": "user-2", "name": "B"}]
                        },
                    },
                ]
            }
        if path == "conv-ok/messages":
            return {
                "data": [
                    {
                        "id": "m1",
                        "created_time": "2026-01-02T03:04:05+0000",
                        "from": {"id": "user-1"},
                        "message": "hi",
                    }
                ]
            }
        if path == "conv-slow/messages":
            raise MetaGraphApiError(
                status_code=502,
                message="Meta Graph proxy call failed: TimeoutError",
            )
        raise AssertionError(f"unexpected Graph path {path}")

    monkeypatch.setenv("META_PAGE_ID", "page-1")
    monkeypatch.setattr(sync, "resolve_page_access_token", lambda: "page-token")
    monkeypatch.setattr(sync, "store_meta_message", _store_capturing(stored))
    monkeypatch.setattr(sync, "graph_get", _with_page_lookup(_graph_get))

    counters = sync.sync_meta_channel_history(SimpleNamespace(), MetaChannel.INSTAGRAM)
    assert counters["stored"] == 1
    assert counters["skipped"] >= 1
    assert stored[0]["platform_user_id"] == "user-1"


def test_sync_stops_paging_after_later_list_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pages = {"count": 0}

    def _graph_get(
        path: str,
        *,
        params: dict[str, str] | None = None,
        token: str | None = None,
    ) -> dict[str, object]:
        if path != "page-1/conversations":
            return {"data": []}
        pages["count"] += 1
        if pages["count"] == 1:
            return {
                "data": [
                    {
                        "id": "conv-1",
                        "participants": {
                            "data": [{"id": "page-1"}, {"id": "user-1", "name": "A"}]
                        },
                    }
                ],
                "paging": {"cursors": {"after": "cursor-2"}},
            }
        raise MetaGraphApiError(
            status_code=502,
            message="Meta Graph proxy call failed: TimeoutError",
        )

    monkeypatch.setenv("META_PAGE_ID", "page-1")
    monkeypatch.setattr(sync, "resolve_page_access_token", lambda: "page-token")
    monkeypatch.setattr(sync, "store_meta_message", _store_capturing([]))
    monkeypatch.setattr(sync, "graph_get", _with_page_lookup(_graph_get))

    counters = sync.sync_meta_channel_history(SimpleNamespace(), MetaChannel.INSTAGRAM)
    assert counters["conversations"] == 1
    assert counters["skipped"] >= 1
    assert pages["count"] == 2
