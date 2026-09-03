"""Audit logging service for tracking data changes.

This module provides:
- Context management for database triggers (set_audit_context)
- Application-level audit logging (AuditService)
- Query interface for audit logs (AuditLogRepository)

SECURITY NOTES:
- User IDs are Cognito subs, not emails (no PII in audit logs)
- Request IDs enable correlation with CloudWatch logs
- Old/new values may contain business data - apply retention policies

Usage:
    # Trigger-backed CRUD (preferred helper):
    with session_with_audit("cognito-sub", "req-123") as session:
        repo = AssetRepository(session)
        repo.create(asset)

    # Custom application events on the same session:
    audit = AuditService(session)
    audit.log_custom("customer_invoices", invoice.id, action="DRAFT_CREATED")
"""

from __future__ import annotations

import enum
import os
from contextlib import contextmanager
from decimal import Decimal
from datetime import datetime
from datetime import timezone
from typing import Any
from collections.abc import Iterator, Sequence
from uuid import UUID

from sqlalchemy import literal
from sqlalchemy import select
from sqlalchemy import text
from sqlalchemy import tuple_
from sqlalchemy.orm import Session

from app.db.engine import get_engine
from app.db.models import AuditLog
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Stored in audit_log.user_id for non-Cognito / non-API-key writers.
SYSTEM_AUDIT_USER_ID = "system"
WEBHOOK_WHATSAPP_AUDIT_USER_ID = "webhook:whatsapp"
WEBHOOK_META_AUDIT_USER_ID = "webhook:meta"
ALEMBIC_AUDIT_USER_ID = "alembic"
SALES_DAILY_PLAN_SCHEDULE_AUDIT_USER_ID = "system:sales-daily-plan"
_MIGRATIONS_REQUEST_ID_ENV = "MIGRATIONS_REQUEST_ID"


def migrations_audit_request_id() -> str | None:
    """Return the deploy-time request id set by the migrations Lambda."""
    value = os.getenv(_MIGRATIONS_REQUEST_ID_ENV, "").strip()
    return value or None


def set_connection_audit_context(
    connection: Any,
    user_id: str | None = None,
    request_id: str | None = None,
    *,
    local: bool = True,
) -> None:
    """Set audit GUCs on a SQLAlchemy Connection or Session."""
    connection.execute(
        text("SELECT set_config('app.current_user_id', :user_id, :is_local)"),
        {"user_id": user_id or "", "is_local": local},
    )
    connection.execute(
        text("SELECT set_config('app.current_request_id', :request_id, :is_local)"),
        {"request_id": request_id or "", "is_local": local},
    )


def stamp_alembic_audit_context(
    connection: Any,
    user_id: str | None = None,
    request_id: str | None = None,
) -> None:
    """Set session-scoped audit GUCs and commit the implicit SQLAlchemy txn.

    Alembic uses ``transaction_per_migration`` so later revisions can see
    committed enum values. Leaving this execute() txn open would nest those
    commits and break ``ALTER TYPE ... ADD VALUE``.
    """
    set_connection_audit_context(
        connection,
        user_id=user_id,
        request_id=request_id,
        local=False,
    )
    connection.commit()


def set_psycopg_audit_context(
    cursor: Any,
    user_id: str | None = None,
    request_id: str | None = None,
    *,
    local: bool = True,
) -> None:
    """Set audit GUCs on a psycopg cursor."""
    cursor.execute(
        "SELECT set_config('app.current_user_id', %s, %s)",
        (user_id or "", local),
    )
    cursor.execute(
        "SELECT set_config('app.current_request_id', %s, %s)",
        (request_id or "", local),
    )


def set_audit_context(
    session: Session,
    user_id: str | None = None,
    request_id: str | None = None,
) -> None:
    """Set audit context for the current database session.

    This sets PostgreSQL session variables that the audit trigger function
    reads to populate user_id and request_id fields. Use SET LOCAL to scope
    the settings to the current transaction only.

    Args:
        session: SQLAlchemy database session.
        user_id: Cognito user sub (subject) making the change.
        request_id: Lambda request ID for log correlation.

    Example:
        with Session(get_engine()) as session:
            set_audit_context(session, user_id=user_sub, request_id=req_id)
            # ... perform database operations ...
            session.commit()
    """
    # Use set_config() instead of SET LOCAL because PostgreSQL's SET command
    # does not support bind parameters ($1), which causes a SyntaxError with
    # psycopg. set_config(name, value, is_local) is a regular SQL function
    # that properly accepts bind parameters, and is_local=true makes the
    # setting transaction-scoped (equivalent to SET LOCAL).
    set_connection_audit_context(session, user_id=user_id, request_id=request_id)


@contextmanager
def session_with_audit(
    user_id: str,
    request_id: str | None = None,
) -> Iterator[Session]:
    """Open a session, begin a transaction, and stamp trigger audit context.

    Use this for mutating admin handlers. Keep ``AuditService`` for custom
    application actions and trigger-exempt tables such as
    ``calendar_manual_blocks``.
    """
    with Session(get_engine()) as session:
        with session.begin():
            set_audit_context(session, user_id=user_id, request_id=request_id)
            yield session


def clear_audit_context(session: Session) -> None:
    """Clear audit context from the current database session.

    This is typically not needed since SET LOCAL is transaction-scoped,
    but can be used for explicit cleanup within a transaction.

    Args:
        session: SQLAlchemy database session.
    """
    session.execute(text("SELECT set_config('app.current_user_id', '', true)"))
    session.execute(text("SELECT set_config('app.current_request_id', '', true)"))


class AuditService:
    """Service for application-level audit logging.

    Use this when you need more control over audit entries than triggers provide,
    such as:
    - Adding IP address or user agent
    - Custom action descriptions
    - Selective field logging (excluding sensitive data)

    For most cases, the trigger-based auditing is sufficient and automatic.
    """

    def __init__(
        self,
        session: Session,
        user_id: str | None = None,
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ):
        """Initialize the audit service.

        Args:
            session: SQLAlchemy database session.
            user_id: Cognito user sub making the change.
            request_id: Lambda request ID for correlation.
            ip_address: Client IP address.
            user_agent: Client user agent string.
        """
        self._session = session
        self._user_id = user_id
        self._request_id = request_id
        self._ip_address = ip_address
        self._user_agent = user_agent

    def log_create(
        self,
        table_name: str,
        record_id: str | UUID,
        new_values: dict[str, Any] | None = None,
    ) -> AuditLog:
        """Log a record creation.

        Args:
            table_name: Name of the table.
            record_id: Primary key of the created record.
            new_values: Dictionary of the new record's values.

        Returns:
            The created AuditLog entry.
        """
        return self._create_entry(
            table_name=table_name,
            record_id=str(record_id),
            action="INSERT",
            new_values=new_values,
        )

    def log_update(
        self,
        table_name: str,
        record_id: str | UUID,
        old_values: dict[str, Any] | None = None,
        new_values: dict[str, Any] | None = None,
        changed_fields: list[str] | None = None,
    ) -> AuditLog:
        """Log a record update.

        Args:
            table_name: Name of the table.
            record_id: Primary key of the updated record.
            old_values: Dictionary of previous values.
            new_values: Dictionary of new values.
            changed_fields: List of field names that changed.

        Returns:
            The created AuditLog entry.
        """
        # Auto-detect changed fields if not provided
        if changed_fields is None and old_values and new_values:
            changed_fields = [
                key
                for key in new_values
                if key in old_values and old_values[key] != new_values[key]
            ]

        return self._create_entry(
            table_name=table_name,
            record_id=str(record_id),
            action="UPDATE",
            old_values=old_values,
            new_values=new_values,
            changed_fields=changed_fields,
        )

    def log_delete(
        self,
        table_name: str,
        record_id: str | UUID,
        old_values: dict[str, Any] | None = None,
    ) -> AuditLog:
        """Log a record deletion.

        Args:
            table_name: Name of the table.
            record_id: Primary key of the deleted record.
            old_values: Dictionary of the deleted record's values.

        Returns:
            The created AuditLog entry.
        """
        return self._create_entry(
            table_name=table_name,
            record_id=str(record_id),
            action="DELETE",
            old_values=old_values,
        )

    def log_custom(
        self,
        table_name: str,
        record_id: str | UUID,
        action: str,
        old_values: dict[str, Any] | None = None,
        new_values: dict[str, Any] | None = None,
        changed_fields: list[str] | None = None,
    ) -> AuditLog:
        """Log a custom action.

        Use this for non-standard operations like:
        - APPROVE, REJECT (for access requests)
        - TRANSFER (for ownership changes)
        - RESTORE (for soft-delete recovery)

        Args:
            table_name: Name of the table.
            record_id: Primary key of the record.
            action: Custom action name.
            old_values: Previous state.
            new_values: New state.
            changed_fields: Fields that changed.

        Returns:
            The created AuditLog entry.
        """
        return self._create_entry(
            table_name=table_name,
            record_id=str(record_id),
            action=action,
            old_values=old_values,
            new_values=new_values,
            changed_fields=changed_fields,
        )

    def _create_entry(
        self,
        table_name: str,
        record_id: str,
        action: str,
        old_values: dict[str, Any] | None = None,
        new_values: dict[str, Any] | None = None,
        changed_fields: list[str] | None = None,
    ) -> AuditLog:
        """Create an audit log entry.

        Args:
            table_name: Name of the table.
            record_id: Primary key of the record.
            action: The action performed.
            old_values: Previous values.
            new_values: New values.
            changed_fields: Fields that changed.

        Returns:
            The created AuditLog entry.
        """
        entry = AuditLog(
            timestamp=datetime.now(timezone.utc),
            table_name=table_name,
            record_id=record_id,
            action=action,
            user_id=self._user_id,
            request_id=self._request_id,
            old_values=old_values,
            new_values=new_values,
            changed_fields=changed_fields,
            source="application",
            ip_address=self._ip_address,
            user_agent=self._user_agent,
        )
        self._session.add(entry)
        self._session.flush()
        return entry


class AuditLogRepository:
    """Repository for querying audit logs.

    Provides methods for retrieving audit history for compliance,
    debugging, and analytics purposes.
    """

    def __init__(self, session: Session):
        """Initialize the repository.

        Args:
            session: SQLAlchemy database session.
        """
        self._session = session

    def get_record_history(
        self,
        table_name: str,
        record_id: str | UUID,
        limit: int = 100,
        cursor: tuple[datetime, UUID] | None = None,
    ) -> Sequence[AuditLog]:
        """Get the audit history for a specific record.

        Args:
            table_name: Name of the table.
            record_id: Primary key of the record.
            limit: Maximum entries to return.
            cursor: Return rows strictly older than this (timestamp, id) pair.

        Returns:
            Audit log entries in reverse chronological order.
        """
        query = (
            select(AuditLog)
            .where(AuditLog.table_name == table_name)
            .where(AuditLog.record_id == str(record_id))
            .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
            .limit(limit)
        )
        if cursor is not None:
            cursor_ts, cursor_id = cursor
            query = query.where(
                tuple_(AuditLog.timestamp, AuditLog.id)
                < tuple_(literal(cursor_ts), literal(cursor_id))
            )
        return self._session.execute(query).scalars().all()

    def get_user_activity(
        self,
        user_id: str,
        limit: int = 100,
        since: datetime | None = None,
        cursor: tuple[datetime, UUID] | None = None,
    ) -> Sequence[AuditLog]:
        """Get audit logs for a specific user.

        Args:
            user_id: Cognito user sub.
            limit: Maximum entries to return.
            since: Only return entries after this timestamp.
            cursor: Return rows strictly older than this (timestamp, id) pair.

        Returns:
            Audit log entries in reverse chronological order.
        """
        query = (
            select(AuditLog)
            .where(AuditLog.user_id == user_id)
            .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
            .limit(limit)
        )
        if since is not None:
            query = query.where(AuditLog.timestamp >= since)
        if cursor is not None:
            cursor_ts, cursor_id = cursor
            query = query.where(
                tuple_(AuditLog.timestamp, AuditLog.id)
                < tuple_(literal(cursor_ts), literal(cursor_id))
            )
        return self._session.execute(query).scalars().all()

    def get_table_activity(
        self,
        table_name: str,
        limit: int = 100,
        since: datetime | None = None,
        action: str | None = None,
        cursor: tuple[datetime, UUID] | None = None,
    ) -> Sequence[AuditLog]:
        """Get audit logs for a specific table.

        Args:
            table_name: Name of the table.
            limit: Maximum entries to return.
            since: Only return entries after this timestamp.
            action: Filter by action type (INSERT, UPDATE, DELETE).
            cursor: Return rows strictly older than this (timestamp, id) pair.

        Returns:
            Audit log entries in reverse chronological order.
        """
        query = (
            select(AuditLog)
            .where(AuditLog.table_name == table_name)
            .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
            .limit(limit)
        )
        if since is not None:
            query = query.where(AuditLog.timestamp >= since)
        if action:
            query = query.where(AuditLog.action == action)
        if cursor is not None:
            cursor_ts, cursor_id = cursor
            query = query.where(
                tuple_(AuditLog.timestamp, AuditLog.id)
                < tuple_(literal(cursor_ts), literal(cursor_id))
            )
        return self._session.execute(query).scalars().all()

    def get_recent_activity(
        self,
        limit: int = 100,
        since: datetime | None = None,
        cursor: tuple[datetime, UUID] | None = None,
    ) -> Sequence[AuditLog]:
        """Get recent audit log entries.

        Args:
            limit: Maximum entries to return.
            since: Only return entries after this timestamp.
            cursor: Return rows strictly older than this (timestamp, id) pair.

        Returns:
            Audit log entries in reverse chronological order.
        """
        query = (
            select(AuditLog)
            .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
            .limit(limit)
        )
        if since is not None:
            query = query.where(AuditLog.timestamp >= since)
        if cursor is not None:
            cursor_ts, cursor_id = cursor
            query = query.where(
                tuple_(AuditLog.timestamp, AuditLog.id)
                < tuple_(literal(cursor_ts), literal(cursor_id))
            )
        return self._session.execute(query).scalars().all()

    def count_by_table(
        self,
        table_name: str,
        since: datetime | None = None,
    ) -> dict[str, int]:
        """Count audit entries by action for a table.

        Args:
            table_name: Name of the table.
            since: Only count entries after this timestamp.

        Returns:
            Dictionary mapping action to count.
        """
        from sqlalchemy import func

        query = (
            select(AuditLog.action, func.count(AuditLog.id))
            .where(AuditLog.table_name == table_name)
            .group_by(AuditLog.action)
        )
        if since:
            query = query.where(AuditLog.timestamp >= since)

        results = self._session.execute(query).all()
        return {action: count for action, count in results}


def serialize_for_audit(
    entity: Any, exclude_fields: set[str] | None = None
) -> dict[str, Any]:
    """Serialize a SQLAlchemy entity for audit logging.

    Converts an entity to a dictionary suitable for storing in audit logs,
    handling common types like UUID, datetime, Decimal, and enums.

    Args:
        entity: SQLAlchemy model instance.
        exclude_fields: Field names to exclude from serialization.

    Returns:
        Dictionary of serialized values.
    """
    exclude = exclude_fields or set()
    result: dict[str, Any] = {}

    # Get all mapped columns
    for column in entity.__table__.columns:
        if column.name in exclude:
            continue

        value = getattr(entity, column.name, None)

        # Handle special types
        if value is None:
            result[column.name] = None
        elif isinstance(value, UUID):
            result[column.name] = str(value)
        elif isinstance(value, datetime):
            result[column.name] = value.isoformat()
        elif isinstance(value, Decimal):
            result[column.name] = float(value)
        elif isinstance(value, enum.Enum):
            result[column.name] = value.value
        elif isinstance(value, (list, dict)):
            result[column.name] = value
        else:
            result[column.name] = value

    return result
