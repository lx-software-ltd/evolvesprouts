"""Normalize and key sales daily plan JSON payloads."""

from __future__ import annotations

from typing import Any
from uuid import UUID

PRIORITY_KINDS = ("reply", "close", "chase_payment", "book", "offer")
PRIORITY_KIND_SET = set(PRIORITY_KINDS)
MAX_SOURCES = 6


def normalize_plan_payload(parsed: dict[str, Any]) -> dict[str, Any]:
    return {
        "focus": str(parsed.get("focus") or "").strip(),
        "priorities": priorities_from_value(parsed.get("priorities")),
        "outreach": outreach_from_value(parsed.get("outreach")),
        "product_focus": str(parsed.get("product_focus") or "").strip(),
        "offer_refinements": string_list(parsed.get("offer_refinements")),
        "risks": string_list(parsed.get("risks")),
    }


def priorities_from_value(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title") or "").strip()
        if not title:
            continue
        lead_id = optional_uuid(entry.get("lead_id"))
        invoice_id = optional_uuid(entry.get("invoice_id"))
        conversation_id = optional_uuid(entry.get("conversation_id"))
        items.append(
            {
                "title": title,
                "why": str(entry.get("why") or "").strip(),
                "action": str(entry.get("action") or "").strip(),
                "lead_id": lead_id,
                "invoice_id": invoice_id,
                "conversation_id": conversation_id,
                "channel": _optional_text(entry.get("channel")),
                "kind": _priority_kind(entry.get("kind")),
                "urgency": _urgency(entry.get("urgency")),
                "sources": string_list(entry.get("sources"))[:MAX_SOURCES],
                "assigned_to": _optional_text(entry.get("assigned_to")),
                "instruction_id": optional_uuid(entry.get("instruction_id")),
                "from_instruction": bool(entry.get("from_instruction")),
                "resurfaced": bool(entry.get("resurfaced")),
                "done": False,
            }
        )
    return items


def outreach_from_value(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        items.append(
            {
                "channel": str(entry.get("channel") or "unknown").strip() or "unknown",
                "lead_id": optional_uuid(entry.get("lead_id")),
                "conversation_id": optional_uuid(entry.get("conversation_id")),
                "message_excerpt": str(entry.get("message_excerpt") or "").strip(),
                "draft_reply": str(entry.get("draft_reply") or "").strip(),
                "rationale": str(entry.get("rationale") or "").strip(),
                "assigned_to": _optional_text(entry.get("assigned_to")),
            }
        )
    return items


def compact_priority_memory(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for entry in payload.get("priorities") or []:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title") or "").strip()
        if not title:
            continue
        items.append(
            {
                "title": title,
                "lead_id": entry.get("lead_id"),
                "invoice_id": entry.get("invoice_id"),
            }
        )
    return items


def suppressed_from_value(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title") or "").strip()
        item_key = str(entry.get("item_key") or "").strip()
        reason = str(entry.get("reason") or "").strip()
        if (
            not title
            or not item_key
            or reason not in {"done_today", "dismissed", "snoozed"}
        ):
            continue
        kind = str(entry.get("item_kind") or "priority").strip()
        if kind not in {"priority", "outreach"}:
            kind = "priority"
        items.append(
            {
                "title": title,
                "item_key": item_key,
                "item_kind": kind,
                "reason": reason,
                "lead_id": optional_uuid(entry.get("lead_id")),
                "invoice_id": optional_uuid(entry.get("invoice_id")),
            }
        )
    return items


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for entry in value:
        text = str(entry or "").strip()
        if text:
            items.append(text)
    return items


def optional_uuid(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return str(UUID(text))
    except ValueError:
        return None


def _priority_kind(value: Any) -> str | None:
    text = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if text in PRIORITY_KIND_SET:
        return text
    return None


def _urgency(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 2
    if parsed in {1, 2, 3}:
        return parsed
    return 2


def _optional_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None
