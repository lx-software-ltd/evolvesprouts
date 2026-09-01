"""AI Helper Detector for new sales leads (Filipino / Bahasa name signals).

Uses the same OpenRouter chat-completion pipeline as the invoice expense
parser. Fail-open: OpenRouter errors never block lead creation.
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.db.models.contact import Contact
from app.db.models.enums import ContactType, FunnelStage, LeadEventType
from app.db.models.sales_lead import SalesLead
from app.db.models.sales_settings import SalesSettings
from app.db.repositories.sales_lead import SalesLeadRepository
from app.services import openrouter_expense_parser as openrouter
from app.utils.logging import get_logger

logger = get_logger(__name__)

_SYSTEM_ACTOR = "system"
_DETECTOR_TIMEOUT_SECONDS = 8
_SYSTEM_PROMPT = (
    "You classify whether a person's name or username looks Filipino "
    "(Tagalog/Filipino) or Bahasa (Indonesian or Malay). "
    "Return strict JSON only."
)


def is_helper_detector_enabled(session: Session) -> bool:
    """Return whether Helper Detector is enabled in sales settings."""
    getter = getattr(session, "get", None)
    if not callable(getter):
        return False
    try:
        row = getter(SalesSettings, 1)
    except Exception:
        return False
    if row is None:
        return False
    enabled = getattr(row, "helper_detector_enabled", False)
    return enabled if isinstance(enabled, bool) else False


def detect_helper_language_signal(
    *,
    first_name: str | None,
    last_name: str | None = None,
    username: str | None = None,
) -> bool:
    """Return True when OpenRouter detects Filipino or Bahasa name signals.

    Fail-open: any error or ambiguous response returns False.
    """
    payload = {
        "first_name": (first_name or "").strip(),
        "last_name": (last_name or "").strip(),
        "username": (username or "").strip(),
    }
    if not any(payload.values()):
        return False

    user_prompt = (
        "Given the contact name fields below, decide if they strongly suggest "
        "Filipino (Tagalog/Filipino) or Bahasa Indonesia/Malay naming or "
        "username patterns common for domestic helpers in Hong Kong.\n"
        "Be conservative: return true only when the signal is clear.\n"
        "Return JSON object: "
        '{"is_helper_language_signal": true|false}\n\n'
        f"{json.dumps(payload, ensure_ascii=False)}"
    )
    try:
        body = openrouter._openrouter_chat_completion(
            system_prompt=_SYSTEM_PROMPT,
            user_content_blocks=[{"type": "text", "text": user_prompt}],
            has_pdf_attachment=False,
            timeout=_DETECTOR_TIMEOUT_SECONDS,
        )
        parsed = openrouter._parse_completion_body(body)
    except Exception:
        logger.warning("Helper detector OpenRouter call failed; leaving lead unchanged")
        return False

    if not isinstance(parsed, dict):
        return False
    flag = parsed.get("is_helper_language_signal")
    if isinstance(flag, bool):
        return flag
    if isinstance(flag, str):
        return flag.strip().lower() in {"true", "yes", "1"}
    return False


def maybe_apply_helper_detector(
    session: Session,
    contact: Contact,
    lead: SalesLead,
    *,
    created_by: str = _SYSTEM_ACTOR,
) -> bool:
    """When enabled and matched, set stage ``unqualified`` and contact ``helper``.

    Contact type is only changed when it is currently ``other``. Returns whether
    the lead was updated.
    """
    if not is_helper_detector_enabled(session):
        return False

    matched = detect_helper_language_signal(
        first_name=getattr(contact, "first_name", None),
        last_name=getattr(contact, "last_name", None),
        username=getattr(contact, "instagram_handle", None),
    )
    if not matched:
        return False

    previous_stage = lead.funnel_stage
    lead.funnel_stage = FunnelStage.UNQUALIFIED
    contact_updated = False
    if getattr(contact, "contact_type", None) is ContactType.OTHER:
        contact.contact_type = ContactType.HELPER
        contact_updated = True

    repository = SalesLeadRepository(session)
    update = getattr(repository, "update", None)
    if callable(update):
        update(lead)
    else:
        session.add(lead)
        session.flush()

    if previous_stage != FunnelStage.UNQUALIFIED:
        repository.add_event(
            lead_id=lead.id,
            event_type=LeadEventType.STAGE_CHANGED,
            metadata={
                "source": "helper_detector",
                "contact_type_updated": contact_updated,
            },
            from_stage=previous_stage,
            to_stage=FunnelStage.UNQUALIFIED,
            created_by=created_by,
        )

    logger.info(
        "Helper detector matched lead",
        extra={
            "lead_id": str(getattr(lead, "id", "")),
            "contact_type_updated": contact_updated,
        },
    )
    return True
