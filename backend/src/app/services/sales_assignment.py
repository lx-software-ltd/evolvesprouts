"""Default lead assignee resolution and assignee notification email."""

from __future__ import annotations

import os
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_audit_actors import cognito_emails_for_subs
from app.db.models.enums import LeadEventType
from app.db.models.sales_lead import SalesLead
from app.db.models.sales_settings import SalesSettings
from app.db.repositories.sales_lead import SalesLeadRepository
from app.services.email import send_email
from app.utils.logging import get_logger, mask_email

logger = get_logger(__name__)

_ASSIGNED_TO_MAX_LENGTH = 128


def read_sales_settings_values(session: Session) -> tuple[str | None, bool]:
    """Return ``(default_assigned_to, notify_enabled)`` without inserting a row.

    Tolerates unit-test fake sessions that do not implement ``Session.get``.
    Unexpected value types from mocks are treated as unset defaults.
    """
    getter = getattr(session, "get", None)
    if not callable(getter):
        return None, False
    try:
        row = getter(SalesSettings, 1)
    except Exception:
        return None, False
    if row is None:
        return None, False
    default = getattr(row, "default_assigned_to", None)
    if default is not None and not isinstance(default, str):
        default = None
    elif isinstance(default, str):
        default = default.strip() or None
        if default is not None and len(default) > _ASSIGNED_TO_MAX_LENGTH:
            default = None
    notify = getattr(row, "notify_assignee_on_assignment", False)
    if not isinstance(notify, bool):
        notify = False
    return default, notify


def resolve_create_assignee(
    session: Session,
    *,
    assigned_to: str | None = None,
    assigned_to_provided: bool = False,
) -> str | None:
    """Return the assignee for a new lead.

    Explicit create payloads (including JSON ``null``) win. When the field is
    omitted, the configured default assignee is used.
    """
    if assigned_to_provided:
        return assigned_to
    default, _notify = read_sales_settings_values(session)
    return default


def record_new_lead_assignment_event(
    lead_repo: SalesLeadRepository,
    *,
    lead_id: UUID | None,
    assigned_to: str | None,
    actor_sub: str | None,
) -> None:
    """Write an ``assigned`` event when a new lead is created with an assignee."""
    if not assigned_to or lead_id is None:
        return
    add_event = getattr(lead_repo, "add_event", None)
    if not callable(add_event):
        return
    add_event(
        lead_id=lead_id,
        event_type=LeadEventType.ASSIGNED,
        metadata={"from": None, "to": assigned_to},
        created_by=actor_sub,
    )


def maybe_notify_assignee(
    session: Session,
    *,
    assigned_to: str | None,
    previous: str | None = None,
    lead_id: str,
    contact_first_name: str | None = None,
    contact_last_name: str | None = None,
    contact_email: str | None = None,
    lead_type: str | None = None,
) -> None:
    """Email the new assignee when the notify flag is on.

    Fires on first assignment and reassignment. Skips unassign and no-ops.
    Failures are logged and do not raise.
    """
    if not assigned_to or assigned_to == previous:
        return
    _default, notify_enabled = read_sales_settings_values(session)
    if not notify_enabled:
        return
    source = os.getenv("SES_SENDER_EMAIL", "").strip()
    pool_id = os.getenv("COGNITO_USER_POOL_ID", "").strip()
    if not source or not pool_id:
        logger.warning(
            "Skipping assignee notification: SES_SENDER_EMAIL or COGNITO_USER_POOL_ID missing"
        )
        return
    try:
        emails = cognito_emails_for_subs([assigned_to], user_pool_id=pool_id)
    except Exception:
        logger.exception(
            "Assignee notification Cognito lookup failed",
            extra={"lead_id": lead_id},
        )
        return
    recipient = emails.get(assigned_to)
    if not recipient:
        logger.warning(
            "Skipping assignee notification: no email for assignee",
            extra={"lead_id": lead_id},
        )
        return
    contact_name = " ".join(
        part for part in (contact_first_name or "", contact_last_name or "") if part
    ).strip()
    body_lines = [
        "A sales lead was assigned to you.",
        "",
        f"Lead ID: {lead_id}",
    ]
    if contact_name:
        body_lines.append(f"Contact: {contact_name}")
    if contact_email:
        body_lines.append(f"Email: {contact_email}")
    if lead_type:
        body_lines.append(f"Lead type: {lead_type}")
    body_text = "\n".join(body_lines) + "\n"
    try:
        send_email(
            source=source,
            to_addresses=[recipient],
            subject="[Sales] A lead was assigned to you",
            body_text=body_text,
        )
    except Exception:
        logger.exception(
            "Assignee notification email failed",
            extra={"lead_id": lead_id, "to": mask_email(recipient)},
        )


def notify_lead_assignee(
    session: Session, lead: SalesLead, *, previous: str | None
) -> None:
    """Notify from a persisted lead row when assignment changed to a user."""
    contact = getattr(lead, "contact", None)
    raw_type = getattr(lead, "lead_type", None)
    lead_type = raw_type.value if raw_type is not None else None
    if not isinstance(lead_type, str):
        lead_type = raw_type if isinstance(raw_type, str) else None
    maybe_notify_assignee(
        session,
        assigned_to=getattr(lead, "assigned_to", None),
        previous=previous,
        lead_id=str(getattr(lead, "id", "") or ""),
        contact_first_name=getattr(contact, "first_name", None),
        contact_last_name=getattr(contact, "last_name", None),
        contact_email=getattr(contact, "email", None),
        lead_type=lead_type,
    )
