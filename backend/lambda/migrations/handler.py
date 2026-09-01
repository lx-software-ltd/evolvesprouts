"""Lambda handler to run Alembic migrations and seed data."""

from __future__ import annotations

import os
from typing import Any, Mapping
from urllib.parse import urlparse

from app.db.connection import get_database_url
from app.utils.cfn_response import send_cfn_response
from app.utils.logging import configure_logging, get_logger

from .runner import _run_migrations
from .seed import _run_seed
from .sync import _sync_active_countries, _sync_proxy_user_passwords
from .utils import _run_with_retry, _truthy

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Handle CloudFormation custom resource events or direct invocations."""
    if event.get("action") == "seed":
        return _handle_seed_only(event, context)

    request_type = event.get("RequestType")
    physical_id = str(event.get("PhysicalResourceId") or "migrations")
    resource_props = event.get("ResourceProperties", {})

    if request_type == "Delete":
        logger.info("Delete request received, skipping migrations")
        data = {"status": "skipped"}
        send_cfn_response(event, context, "SUCCESS", data, physical_id)
        return {"PhysicalResourceId": physical_id, "Data": data}

    try:
        request_id = str(getattr(context, "aws_request_id", "") or "").strip()
        if request_id:
            os.environ["MIGRATIONS_REQUEST_ID"] = request_id
        database_url = get_database_url()

        parsed = urlparse(database_url)
        logger.info(
            "Connecting to database: host=%s, port=%s, user=%s, database=%s",
            parsed.hostname,
            parsed.port,
            parsed.username,
            parsed.path.lstrip("/"),
        )

        _run_with_retry(_run_migrations, database_url)
        _run_with_retry(_sync_proxy_user_passwords, database_url)
        _run_with_retry(_sync_active_countries, database_url)

        run_seed = _truthy(resource_props.get("RunSeed"))
        if run_seed:
            seed_path = os.getenv(
                "SEED_FILE_PATH",
                "/var/task/db/seed/seed_data.sql",
            )
            _run_with_retry(_run_seed, database_url, seed_path)

        logger.info("Migrations completed successfully")
        data = {"status": "ok"}
        send_cfn_response(event, context, "SUCCESS", data, physical_id)
        return {"PhysicalResourceId": physical_id, "Data": data}
    except Exception as exc:
        if _should_ignore_missing_revision_during_update(event, exc):
            logger.warning(
                "Skipping migration failure during update because the database is already at a newer revision than the bundled rollback code",
                extra={"error_message": str(exc)},
            )
            data = {"status": "skipped", "reason": "database_revision_ahead"}
            send_cfn_response(event, context, "SUCCESS", data, physical_id)
            return {"PhysicalResourceId": physical_id, "Data": data}
        error_type = type(exc).__name__
        error_msg = str(exc)
        truncated_msg = error_msg[:200] if len(error_msg) > 200 else error_msg
        reason = f"{error_type}: {truncated_msg}"
        logger.error(
            "Migrations failed",
            extra={"error_type": error_type, "error_message": error_msg},
            exc_info=True,
        )
        data = {"status": "failed", "error_type": error_type}
        send_cfn_response(
            event,
            context,
            "FAILED",
            data,
            physical_id,
            reason,
        )
        return {"PhysicalResourceId": physical_id, "Data": data}


def _should_ignore_missing_revision_during_update(
    event: Mapping[str, Any],
    exc: Exception,
) -> bool:
    request_type = str(event.get("RequestType") or "")
    if request_type != "Update":
        return False
    error_message = str(exc)
    return "Can't locate revision identified by" in error_message


def _handle_seed_only(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Handle direct invocation for seeding only (not via CloudFormation)."""
    logger.info("Running seed-only mode (direct invocation)")

    try:
        request_id = str(getattr(context, "aws_request_id", "") or "").strip()
        if request_id:
            os.environ["MIGRATIONS_REQUEST_ID"] = request_id
        database_url = get_database_url()

        seed_path = os.getenv(
            "SEED_FILE_PATH",
            "/var/task/db/seed/seed_data.sql",
        )
        _run_with_retry(_run_seed, database_url, seed_path)

        logger.info("Seeding completed successfully")
        return {"status": "ok", "action": "seed"}

    except Exception as exc:
        error_type = type(exc).__name__
        error_msg = str(exc)
        logger.error(
            "Seeding failed",
            extra={"error_type": error_type, "error_message": error_msg},
            exc_info=True,
        )
        return {"status": "failed", "action": "seed", "error": str(exc)}
