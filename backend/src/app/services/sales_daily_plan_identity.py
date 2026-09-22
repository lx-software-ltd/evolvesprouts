"""Stable identities for insight priorities and outreach rows.

Entity ids win over the model title, which changes between generations.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

_NON_WORD = re.compile(r"[^\w\s]", flags=re.UNICODE)
_SPACES = re.compile(r"\s+")


def normalize_title(title: str) -> str:
    text = _NON_WORD.sub(" ", (title or "").strip().lower())
    return _SPACES.sub(" ", text).strip()


def priority_identity(
    *,
    kind: str | None,
    lead_id: UUID | str | None,
    invoice_id: UUID | str | None,
    conversation_id: UUID | str | None,
    title: str,
    instruction_id: UUID | str | None = None,
) -> str:
    """Identity for one priority. Invoice, then thread, then lead+kind, then note."""
    invoice = uuid_text(invoice_id)
    if invoice:
        return f"invoice:{invoice}"
    conversation = uuid_text(conversation_id)
    if conversation:
        return f"conversation:{conversation}"
    lead = uuid_text(lead_id)
    if lead:
        kind_part = (kind or "any").strip().lower().replace("-", "_") or "any"
        return f"lead:{lead}:{kind_part}"
    instruction = uuid_text(instruction_id)
    if instruction:
        return f"instruction:{instruction}"
    normalized = normalize_title(title)
    return f"title:{normalized}" if normalized else "title:untitled"


def outreach_identity(
    *,
    conversation_id: UUID | str | None,
    lead_id: UUID | str | None,
    channel: str | None,
    message_excerpt: str,
) -> str:
    conversation = uuid_text(conversation_id)
    if conversation:
        return f"conversation:{conversation}"
    lead = uuid_text(lead_id)
    if lead:
        return f"lead:{lead}:outreach"
    excerpt = normalize_title(message_excerpt)
    channel_part = (channel or "unknown").strip().lower() or "unknown"
    if excerpt:
        return f"excerpt:{channel_part}:{excerpt}"
    return f"excerpt:{channel_part}"


def priority_fields_from_identity(identity: str) -> dict[str, str | None]:
    """Fields that make ``priority_identity`` reproduce this key.

    An empty dict means the key is a title (or unrecognized) and the stored
    title is enough.
    """
    text = (identity or "").strip()
    if text.startswith("invoice:"):
        invoice = uuid_text(text.removeprefix("invoice:"))
        if invoice:
            return {
                "invoice_id": invoice,
                "conversation_id": None,
                "lead_id": None,
                "kind": None,
                "instruction_id": None,
            }
    if text.startswith("conversation:"):
        conversation = uuid_text(text.removeprefix("conversation:"))
        if conversation:
            return {
                "invoice_id": None,
                "conversation_id": conversation,
                "lead_id": None,
                "kind": None,
                "instruction_id": None,
            }
    if text.startswith("lead:"):
        lead, _sep, kind = text.removeprefix("lead:").partition(":")
        parsed = uuid_text(lead)
        if parsed and _sep:
            return {
                "invoice_id": None,
                "conversation_id": None,
                "lead_id": parsed,
                "kind": kind or "any",
                "instruction_id": None,
            }
    if text.startswith("instruction:"):
        instruction = uuid_text(text.removeprefix("instruction:"))
        if instruction:
            return {
                "invoice_id": None,
                "conversation_id": None,
                "lead_id": None,
                "kind": None,
                "instruction_id": instruction,
            }
    return {}


def outreach_fields_from_identity(identity: str) -> dict[str, str | None]:
    """Fields that make ``outreach_identity`` reproduce this key."""
    text = (identity or "").strip()
    if text.startswith("conversation:"):
        conversation = uuid_text(text.removeprefix("conversation:"))
        if conversation:
            return {
                "conversation_id": conversation,
                "lead_id": None,
                "channel": "unknown",
                "message_excerpt": "",
            }
    if text.startswith("lead:"):
        lead, _sep, kind = text.removeprefix("lead:").partition(":")
        parsed = uuid_text(lead)
        if parsed and kind == "outreach":
            return {
                "conversation_id": None,
                "lead_id": parsed,
                "channel": "unknown",
                "message_excerpt": "",
            }
    if text.startswith("excerpt:"):
        channel, sep, excerpt = text.removeprefix("excerpt:").partition(":")
        return {
            "conversation_id": None,
            "lead_id": None,
            "channel": channel or "unknown",
            "message_excerpt": excerpt if sep else "",
        }
    return {}


def uuid_text(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return str(UUID(text))
    except ValueError:
        return None
