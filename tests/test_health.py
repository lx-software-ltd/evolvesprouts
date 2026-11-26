from __future__ import annotations

import json
from typing import Any

from app.api import health


def test_check_health_never_returns_internal_exception_text(
    monkeypatch: Any,
) -> None:
    def _fail_db() -> health.HealthCheck:
        return health.HealthCheck(
            name="database",
            healthy=False,
            error="database check failed",
        )

    monkeypatch.setattr(health, "_check_database", _fail_db)
    monkeypatch.setattr(
        health,
        "_check_configuration",
        lambda: health.HealthCheck(name="configuration", healthy=True),
    )

    status = health.check_health()
    body = status.to_dict()

    assert status.healthy is False
    assert body == {
        "healthy": False,
        "version": "unknown",
        "environment": "unknown",
    }
    assert "Traceback" not in str(body)
    assert "SELECT" not in str(body)


def test_open_health_does_not_call_database(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    def _forbidden() -> health.HealthCheck:
        raise AssertionError("open health called a dependency helper")

    monkeypatch.setattr(health, "_check_database", _forbidden)
    monkeypatch.setattr(health, "_check_configuration", _forbidden)

    response = health.lambda_handler(
        api_gateway_event(method="GET", path="/health"),
        None,
    )

    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"status": "ok"}


def test_admin_health_runs_dependency_checks(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(
        health,
        "_check_database",
        lambda: health.HealthCheck(name="database", healthy=True),
    )
    monkeypatch.setattr(
        health,
        "_check_configuration",
        lambda: health.HealthCheck(name="configuration", healthy=True),
    )
    monkeypatch.setenv("APP_VERSION", "9.9.9")
    monkeypatch.setenv("ENVIRONMENT", "test")

    response = health.handle_admin_health(
        api_gateway_event(method="GET", path="/v1/admin/health"),
        "GET",
        "/v1/admin/health",
    )

    assert response["statusCode"] == 200
    assert json.loads(response["body"])["healthy"] is True
    assert json.loads(response["body"])["version"] == "9.9.9"
