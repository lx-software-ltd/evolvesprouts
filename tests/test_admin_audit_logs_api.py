from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.api import admin_audit_actors, admin_audit_logs
from app.api.admin_request import encode_created_cursor, parse_created_cursor
from app.db.auditable_tables import AUDITABLE_TABLES
from app.exceptions import AuthorizationError, ValidationError
from app.db.models import AuditLog


def _row(
    *,
    rid: UUID | None = None,
    ts: datetime | None = None,
    user: str | None = "sub-1",
) -> AuditLog:
    return AuditLog(
        id=rid or uuid4(),
        timestamp=ts or datetime.now(timezone.utc),
        table_name="assets",
        record_id="rec-1",
        action="INSERT",
        user_id=user,
        request_id="req-1",
        old_values=None,
        new_values={"a": 1},
        changed_fields=None,
        source="trigger",
        ip_address=None,
        user_agent=None,
    )


def test_audit_logs_list_requires_identity(api_gateway_event: Any) -> None:
    with pytest.raises(AuthorizationError, match="Authenticated user is required"):
        admin_audit_logs.handle_admin_audit_logs_request(
            api_gateway_event(method="GET", path="/v1/admin/audit-logs"),
            "GET",
            "/v1/admin/audit-logs",
        )


def test_audit_logs_rejects_unknown_table(
    api_gateway_event: Any, admin_identity: dict[str, str]
) -> None:
    with pytest.raises(ValidationError):
        admin_audit_logs.handle_admin_audit_logs_request(
            api_gateway_event(
                method="GET",
                path="/v1/admin/audit-logs",
                query_params={"table": "not_a_table"},
                authorizer_context=admin_identity,
            ),
            "GET",
            "/v1/admin/audit-logs",
        )


def test_recent_list_cursor_second_page(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    t1 = datetime(2024, 1, 2, tzinfo=timezone.utc)
    t2 = datetime(2024, 1, 1, tzinfo=timezone.utc)
    id1 = uuid4()
    id2 = uuid4()
    row1 = _row(rid=id1, ts=t1)
    row2 = _row(rid=id2, ts=t2)
    calls: list[dict[str, Any]] = []

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_recent_activity(self, **kwargs: Any) -> list[AuditLog]:
            calls.append(kwargs)
            if kwargs.get("cursor") is None:
                return [row1, row2]
            return [row2]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs, "_actor_labels_for_user_ids", lambda *_a, **_: {}
    )

    r1 = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"limit": "1"},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    assert r1["statusCode"] == 200
    body1 = json.loads(r1["body"])
    assert body1["next_cursor"]
    assert len(body1["items"]) == 1
    assert body1["items"][0]["id"] == str(id1)

    r2 = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"limit": "1", "cursor": body1["next_cursor"]},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    body2 = json.loads(r2["body"])
    assert body2["next_cursor"] is None
    assert len(body2["items"]) == 1
    assert body2["items"][0]["id"] == str(id2)

    assert len(calls) == 2
    assert calls[0]["cursor"] is None
    c_ts, c_id = calls[1]["cursor"]
    assert c_ts == t1
    assert c_id == id1


def test_user_id_filter_cursor_second_page(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    t1 = datetime(2024, 2, 2, tzinfo=timezone.utc)
    t2 = datetime(2024, 2, 1, tzinfo=timezone.utc)
    id1 = uuid4()
    id2 = uuid4()
    row1 = _row(rid=id1, ts=t1)
    row2 = _row(rid=id2, ts=t2)
    calls: list[dict[str, Any]] = []

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_user_activity(self, **kwargs: Any) -> list[AuditLog]:
            calls.append(kwargs)
            if kwargs.get("cursor") is None:
                return [row1, row2]
            return [row2]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs, "_actor_labels_for_user_ids", lambda *_a, **_: {}
    )

    uid = "user-sub-abc"
    r1 = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"limit": "1", "user_id": uid},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    body1 = json.loads(r1["body"])
    assert body1["next_cursor"]
    assert body1["items"][0]["id"] == str(id1)

    r2 = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"limit": "1", "user_id": uid, "cursor": body1["next_cursor"]},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    body2 = json.loads(r2["body"])
    assert body2["next_cursor"] is None
    assert body2["items"][0]["id"] == str(id2)
    assert calls[0]["user_id"] == uid
    assert calls[1]["cursor"] is not None


def test_table_filter_cursor_second_page(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    t1 = datetime(2024, 3, 2, tzinfo=timezone.utc)
    t2 = datetime(2024, 3, 1, tzinfo=timezone.utc)
    id1 = uuid4()
    id2 = uuid4()
    row1 = _row(rid=id1, ts=t1)
    row2 = _row(rid=id2, ts=t2)
    calls: list[dict[str, Any]] = []

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_table_activity(self, **kwargs: Any) -> list[AuditLog]:
            calls.append(kwargs)
            if kwargs.get("cursor") is None:
                return [row1, row2]
            return [row2]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs, "_actor_labels_for_user_ids", lambda *_a, **_: {}
    )

    r1 = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"limit": "1", "table": "assets"},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    body1 = json.loads(r1["body"])
    assert body1["next_cursor"]
    assert body1["items"][0]["id"] == str(id1)

    r2 = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={
                "limit": "1",
                "table": "assets",
                "cursor": body1["next_cursor"],
            },
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    body2 = json.loads(r2["body"])
    assert body2["next_cursor"] is None
    assert body2["items"][0]["id"] == str(id2)
    assert calls[0]["table_name"] == "assets"
    assert calls[1]["cursor"] is not None


def test_record_id_table_cursor_second_page(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    t1 = datetime(2024, 4, 2, tzinfo=timezone.utc)
    t2 = datetime(2024, 4, 1, tzinfo=timezone.utc)
    id1 = uuid4()
    id2 = uuid4()
    row1 = _row(rid=id1, ts=t1)
    row2 = _row(rid=id2, ts=t2)
    calls: list[dict[str, Any]] = []

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_record_history(self, **kwargs: Any) -> list[AuditLog]:
            calls.append(kwargs)
            if kwargs.get("cursor") is None:
                return [row1, row2]
            return [row2]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs, "_actor_labels_for_user_ids", lambda *_a, **_: {}
    )

    rid = "rec-xyz"
    r1 = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"limit": "1", "table": "assets", "record_id": rid},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    body1 = json.loads(r1["body"])
    assert body1["next_cursor"]
    assert body1["items"][0]["id"] == str(id1)

    r2 = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={
                "limit": "1",
                "table": "assets",
                "record_id": rid,
                "cursor": body1["next_cursor"],
            },
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    body2 = json.loads(r2["body"])
    assert body2["next_cursor"] is None
    assert body2["items"][0]["id"] == str(id2)
    assert calls[0]["record_id"] == rid
    assert calls[1]["cursor"] is not None


def test_table_filter_cursor_passed(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _row()
    calls: list[dict[str, Any]] = []

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_table_activity(self, **kwargs: Any) -> list[AuditLog]:
            calls.append(kwargs)
            return [row]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs, "_actor_labels_for_user_ids", lambda *_a, **_: {}
    )

    cur = encode_created_cursor(row.timestamp, row.id)
    assert cur
    admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"table": "assets", "cursor": cur},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    assert calls[0]["cursor"] is not None
    assert calls[0]["cursor"][1] == row.id


def test_next_cursor_null_when_not_full_page(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _row()

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_recent_activity(self, **_kwargs: Any) -> list[AuditLog]:
            return [row]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs, "_actor_labels_for_user_ids", lambda *_a, **_: {}
    )

    r = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"limit": "10"},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    body = json.loads(r["body"])
    assert body["next_cursor"] is None


def test_recent_list_empty_returns_200(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: empty result must not IndexError when building next_cursor."""

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_recent_activity(self, **_kwargs: Any) -> list[AuditLog]:
            return []

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs, "_actor_labels_for_user_ids", lambda *_a, **_: {}
    )

    r = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["items"] == []
    assert body["next_cursor"] is None


def test_email_filter_resolves_sub(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolved_sub = "cognito-sub-xyz"
    row = _row(user=resolved_sub)
    cognito_calls: list[dict[str, Any]] = []
    repo_calls: list[dict[str, Any]] = []

    def fake_invoke(_svc: str, _action: str, params: dict[str, Any]) -> dict[str, Any]:
        cognito_calls.append(params)
        return {
            "Users": [
                {
                    "Attributes": [
                        {"Name": "sub", "Value": resolved_sub},
                        {"Name": "email", "Value": "a@b.com"},
                    ],
                }
            ],
        }

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_user_activity(self, **kwargs: Any) -> list[AuditLog]:
            repo_calls.append(kwargs)
            return [row]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(admin_audit_actors.aws_proxy, "invoke", fake_invoke)
    monkeypatch.setattr(
        admin_audit_logs,
        "_actor_labels_for_user_ids",
        lambda *_a, **_: {"cognito-sub-xyz": "a@b.com"},
    )
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "pool-1")

    r = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"email": "a@b.com"},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert len(body["items"]) == 1
    assert body["items"][0]["user_email"] == "a@b.com"
    assert repo_calls[0]["user_id"] == resolved_sub
    assert 'email = "a@b.com"' in cognito_calls[0]["Filter"]


def test_email_filter_no_users_returns_empty(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_invoke(_svc: str, _action: str, _params: dict[str, Any]) -> dict[str, Any]:
        return {"Users": []}

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_user_activity(self, **_kwargs: Any) -> list[AuditLog]:
            raise AssertionError("repo should not run when email has no match")

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(admin_audit_actors.aws_proxy, "invoke", fake_invoke)
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "pool-1")

    r = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"email": "nobody@example.com"},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    body = json.loads(r["body"])
    assert body == {"items": [], "next_cursor": None}


def test_email_and_user_id_rejected(
    api_gateway_event: Any, admin_identity: dict[str, str]
) -> None:
    with pytest.raises(ValidationError):
        admin_audit_logs.handle_admin_audit_logs_request(
            api_gateway_event(
                method="GET",
                path="/v1/admin/audit-logs",
                query_params={"email": "a@b.com", "user_id": "x"},
                authorizer_context=admin_identity,
            ),
            "GET",
            "/v1/admin/audit-logs",
        )


def test_invalid_email_rejected(
    api_gateway_event: Any, admin_identity: dict[str, str]
) -> None:
    with pytest.raises(ValidationError) as exc:
        admin_audit_logs.handle_admin_audit_logs_request(
            api_gateway_event(
                method="GET",
                path="/v1/admin/audit-logs",
                query_params={"email": 'bad"email@example.com'},
                authorizer_context=admin_identity,
            ),
            "GET",
            "/v1/admin/audit-logs",
        )
    assert exc.value.field == "email"


def test_record_history_cursor(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _row()
    calls: list[dict[str, Any]] = []

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_record_history(self, **kwargs: Any) -> list[AuditLog]:
            calls.append(kwargs)
            return [row]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs, "_actor_labels_for_user_ids", lambda *_a, **_: {}
    )

    cur = encode_created_cursor(row.timestamp, row.id)
    admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"table": "assets", "record_id": "rid", "cursor": cur},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    assert calls[0]["cursor"] is not None
    ts, rid = parse_created_cursor(cur)
    assert ts == row.timestamp
    assert rid == row.id


def test_audit_log_redacts_billing_pii_fields() -> None:
    entry = AuditLog(
        id=uuid4(),
        timestamp=datetime.now(timezone.utc),
        table_name="customer_invoices",
        record_id="inv-1",
        action="UPDATE",
        user_id="sub-1",
        request_id="req-1",
        old_values={
            "bill_to_email": "client@example.com",
            "bill_to_display_name": "Client Name",
            "status": "draft",
        },
        new_values={
            "bill_to_email": "client@example.com",
            "bill_to_phone": "+85212345678",
            "total": "100.00",
        },
        changed_fields=["bill_to_email", "total"],
        source="trigger",
        ip_address=None,
        user_agent=None,
    )
    payload = admin_audit_logs._serialize_audit_log(entry)
    assert payload["old_values"]["bill_to_email"] == "***REDACTED***"
    assert payload["old_values"]["bill_to_display_name"] == "***REDACTED***"
    assert payload["old_values"]["status"] == "draft"
    assert payload["new_values"]["bill_to_phone"] == "***REDACTED***"
    assert payload["new_values"]["total"] == "100.00"
    assert payload["changed_fields"] == ["bill_to_email", "total"]


def test_audit_log_redacts_bill_to_snapshot_whole_dict() -> None:
    """bill_to_snapshot must be fully redacted, not partially scrubbed by nested keys."""
    entry = AuditLog(
        id=uuid4(),
        timestamp=datetime.now(timezone.utc),
        table_name="customer_invoices",
        record_id="inv-2",
        action="UPDATE",
        user_id="sub-1",
        request_id="req-2",
        old_values=None,
        new_values={
            "bill_to_snapshot": {
                "kind": "contact",
                "display_name": "Jane Client",
                "email": "jane@example.com",
                "location_text": "123 Main St, Hong Kong",
                "snapshot_at": "2026-01-01T00:00:00+00:00",
                "contact": {
                    "id": "c-1",
                    "first_name": "Jane",
                    "last_name": "Client",
                    "email": "jane@example.com",
                },
                "family": {"id": "f-1", "family_name": "Client Family"},
                "organization": {"id": "o-1", "name": "Client Org"},
            },
            "total": "250.00",
        },
        changed_fields=["bill_to_snapshot", "total"],
        source="trigger",
        ip_address=None,
        user_agent=None,
    )
    payload = admin_audit_logs._serialize_audit_log(entry)
    assert payload["new_values"]["bill_to_snapshot"] == "***REDACTED***"
    assert payload["new_values"]["total"] == "250.00"


def test_audit_log_redacts_nested_pii_under_non_pii_keys() -> None:
    entry = AuditLog(
        id=uuid4(),
        timestamp=datetime.now(timezone.utc),
        table_name="customer_invoices",
        record_id="inv-3",
        action="UPDATE",
        user_id="sub-1",
        request_id="req-3",
        old_values=None,
        new_values={
            "metadata": {
                "contact_email": "nested@example.com",
                "invoice_ref": "INV-100",
            },
        },
        changed_fields=["metadata"],
        source="trigger",
        ip_address=None,
        user_agent=None,
    )
    payload = admin_audit_logs._serialize_audit_log(entry)
    assert payload["new_values"]["metadata"]["contact_email"] == "***REDACTED***"
    assert payload["new_values"]["metadata"]["invoice_ref"] == "INV-100"


def test_audit_log_redacts_pii_inside_lists() -> None:
    entry = AuditLog(
        id=uuid4(),
        timestamp=datetime.now(timezone.utc),
        table_name="customer_invoices",
        record_id="inv-4",
        action="UPDATE",
        user_id="sub-1",
        request_id="req-4",
        old_values=None,
        new_values={
            "recipients": [
                {"name": "Alice", "email": "alice@example.com"},
                {"name": "Bob", "email": "bob@example.com"},
            ],
        },
        changed_fields=["recipients"],
        source="trigger",
        ip_address=None,
        user_agent=None,
    )
    payload = admin_audit_logs._serialize_audit_log(entry)
    recipients = payload["new_values"]["recipients"]
    assert recipients[0]["email"] == "***REDACTED***"
    assert recipients[1]["email"] == "***REDACTED***"
    # Personal names are PII and must be masked too (substring match on "name").
    assert recipients[0]["name"] == "***REDACTED***"
    assert recipients[1]["name"] == "***REDACTED***"


def test_cognito_emails_for_subs_uses_request_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def fake_invoke(_svc: str, _action: str, params: dict[str, Any]) -> dict[str, Any]:
        sub = params["Filter"].split('"')[1]
        calls.append(sub)
        return {
            "Users": [
                {
                    "Attributes": [
                        {"Name": "sub", "Value": sub},
                        {"Name": "email", "Value": f"{sub}@example.com"},
                    ],
                }
            ],
        }

    monkeypatch.setattr(admin_audit_actors.aws_proxy, "invoke", fake_invoke)
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "pool-1")
    cache: dict[str, str] = {}
    subs = ["sub-a", "sub-b", "sub-a"]
    result = admin_audit_logs._cognito_emails_for_subs(subs, cache=cache)
    assert result == {
        "sub-a": "sub-a@example.com",
        "sub-b": "sub-b@example.com",
    }
    assert calls == ["sub-a", "sub-b"]


def test_auditable_tables_include_contacts_and_crm() -> None:
    assert "contacts" in AUDITABLE_TABLES
    assert "families" in AUDITABLE_TABLES
    assert "enrollments" in AUDITABLE_TABLES
    assert "audit_log" not in AUDITABLE_TABLES


def test_contacts_table_filter_accepted(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _row()
    row.table_name = "contacts"

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_table_activity(self, **kwargs: Any) -> list[AuditLog]:
            assert kwargs["table_name"] == "contacts"
            return [row]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs, "_actor_labels_for_user_ids", lambda *_a, **_: {}
    )
    r = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"table": "contacts"},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["items"][0]["table_name"] == "contacts"


def test_serialize_api_key_actor_uses_raw_name() -> None:
    key_id = uuid4()
    entry = _row(user=f"api-key:{key_id}")
    payload = admin_audit_logs._serialize_audit_log(
        entry, email_map={f"api-key:{key_id}": "Prod CRM full access"}
    )
    assert payload["user_email"] == "Prod CRM full access"


def test_actor_labels_skip_cognito_for_api_key_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key_id = uuid4()
    user_id = f"api-key:{key_id}"
    cognito_calls: list[str] = []

    def fake_invoke(_svc: str, _action: str, params: dict[str, Any]) -> dict[str, Any]:
        cognito_calls.append(params["Filter"])
        return {"Users": []}

    class _Result:
        def all(self) -> list[Any]:
            return [type("Row", (), {"id": key_id, "name": "Prod CRM"})()]

    class _Session:
        def execute(self, *_a: object, **_k: object) -> _Result:
            return _Result()

    monkeypatch.setattr(admin_audit_actors.aws_proxy, "invoke", fake_invoke)
    labels = admin_audit_actors.actor_labels_for_user_ids(
        _Session(),  # type: ignore[arg-type]
        [user_id],
        user_pool_id="pool-1",
    )
    assert labels[user_id] == "Prod CRM"
    assert cognito_calls == []


def test_api_key_name_filter_resolves(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key_id = uuid4()
    row = _row(user=f"api-key:{key_id}")
    repo_calls: list[dict[str, Any]] = []

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_user_activity(self, **kwargs: Any) -> list[AuditLog]:
            repo_calls.append(kwargs)
            return [row]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs,
        "api_key_user_id_for_name",
        lambda _session, name: f"api-key:{key_id}" if name == "Prod CRM" else None,
    )
    monkeypatch.setattr(
        admin_audit_logs,
        "_actor_labels_for_user_ids",
        lambda *_a, **_: {f"api-key:{key_id}": "Prod CRM"},
    )

    r = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"email": "Prod CRM"},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["items"][0]["user_email"] == "Prod CRM"
    assert repo_calls[0]["user_id"] == f"api-key:{key_id}"


def test_api_key_name_filter_no_match_returns_empty(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_user_activity(self, **_kwargs: Any) -> list[AuditLog]:
            raise AssertionError("repo should not run when API key name has no match")

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs, "api_key_user_id_for_name", lambda *_a, **_: None
    )

    r = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"email": "Unknown Key"},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    assert json.loads(r["body"]) == {"items": [], "next_cursor": None}


def test_system_actor_labels_skip_cognito(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cognito_calls: list[str] = []

    def fake_invoke(_svc: str, _action: str, params: dict[str, Any]) -> dict[str, Any]:
        cognito_calls.append(params["Filter"])
        return {"Users": []}

    class _Session:
        def execute(self, *_a: object, **_k: object) -> None:
            raise AssertionError("API key lookup should not run for system actors")

    monkeypatch.setattr(admin_audit_actors.aws_proxy, "invoke", fake_invoke)
    labels = admin_audit_actors.actor_labels_for_user_ids(
        _Session(),  # type: ignore[arg-type]
        [
            "webhook:whatsapp",
            "webhook:meta",
            "system",
            "alembic",
            "system:sales-daily-plan",
        ],
        user_pool_id="pool-1",
    )
    assert labels == {
        "webhook:whatsapp": "WhatsApp webhook",
        "webhook:meta": "Meta webhook",
        "system": "System",
        "alembic": "Alembic",
        "system:sales-daily-plan": "Sales daily plan schedule",
    }
    assert cognito_calls == []


def test_system_actor_filter_resolves(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _row(user="webhook:whatsapp")
    repo_calls: list[dict[str, Any]] = []

    class _Session:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> None:
            return None

    class _Repo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_user_activity(self, **kwargs: Any) -> list[AuditLog]:
            repo_calls.append(kwargs)
            return [row]

    monkeypatch.setattr(admin_audit_logs, "Session", _Session)
    monkeypatch.setattr(admin_audit_logs, "get_engine", lambda: object())
    monkeypatch.setattr(admin_audit_logs, "AuditLogRepository", _Repo)
    monkeypatch.setattr(
        admin_audit_logs,
        "_actor_labels_for_user_ids",
        lambda *_a, **_: {"webhook:whatsapp": "WhatsApp webhook"},
    )

    r = admin_audit_logs.handle_admin_audit_logs_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/audit-logs",
            query_params={"email": "WhatsApp webhook"},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/audit-logs",
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["items"][0]["user_email"] == "WhatsApp webhook"
    assert repo_calls[0]["user_id"] == "webhook:whatsapp"


def test_system_actor_user_id_for_label_accepts_id_or_display() -> None:
    assert (
        admin_audit_actors.system_actor_user_id_for_label("whatsapp webhook")
        == "webhook:whatsapp"
    )
    assert admin_audit_actors.system_actor_user_id_for_label("SYSTEM") == "system"
    assert admin_audit_actors.system_actor_user_id_for_label("Alembic") == "alembic"
    assert admin_audit_actors.system_actor_user_id_for_label("alembic") == "alembic"
    assert (
        admin_audit_actors.system_actor_user_id_for_label("webhook:meta")
        == "webhook:meta"
    )
    assert (
        admin_audit_actors.system_actor_user_id_for_label("Sales daily plan schedule")
        == "system:sales-daily-plan"
    )
    assert (
        admin_audit_actors.system_actor_user_id_for_label("system:sales-daily-plan")
        == "system:sales-daily-plan"
    )
    assert admin_audit_actors.system_actor_user_id_for_label("unknown") is None


def test_missing_api_key_falls_back_to_user_id() -> None:
    user_id = f"api-key:{uuid4()}"

    class _Result:
        def all(self) -> list[Any]:
            return []

    class _Session:
        def execute(self, *_a: object, **_k: object) -> _Result:
            return _Result()

    labels = admin_audit_actors.actor_labels_for_user_ids(
        _Session(),  # type: ignore[arg-type]
        [user_id],
        user_pool_id=None,
    )
    assert labels[user_id] == user_id
