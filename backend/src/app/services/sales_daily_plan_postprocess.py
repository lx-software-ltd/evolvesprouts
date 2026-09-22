"""Deterministic filters applied after the insight model responds."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.sales_daily_plan_identity import (
    normalize_title,
    outreach_identity,
    priority_identity,
    uuid_text,
)
from app.services.sales_daily_plan_time import as_utc

_SUPPRESSED_REASONS = {"done_today", "dismissed", "snoozed"}
_MIN_INSTRUCTION_MATCH = 8


def apply_generation_rules(
    payload: dict[str, Any],
    *,
    context: dict[str, Any],
) -> dict[str, Any]:
    """Drop suppressed items, dedupe, and guarantee today's instructions."""
    suppressed = _suppressed_index(context.get("suppressed_items"))
    known = _known_entities(context)
    activity = _activity_index(context)
    seen: set[str] = set()
    priorities: list[dict[str, Any]] = []
    hidden: list[dict[str, Any]] = []
    for entry in payload.get("priorities") or []:
        if not isinstance(entry, dict):
            continue
        item = dict(entry)
        identity = priority_identity(
            kind=_text(item.get("kind")),
            lead_id=item.get("lead_id"),
            invoice_id=item.get("invoice_id"),
            conversation_id=item.get("conversation_id"),
            title=str(item.get("title") or ""),
            instruction_id=item.get("instruction_id"),
        )
        item["item_key"] = identity
        item["from_instruction"] = bool(item.get("from_instruction"))
        item["resurfaced"] = False
        if _references_unknown_entity(item, known):
            continue
        block = suppressed.get(identity)
        if block is not None and not _resurfaced(item, block, activity):
            hidden.append(_hidden_entry(item, block, item_kind="priority"))
            continue
        if identity in seen:
            _prefer_higher_urgency(priorities, identity, item)
            continue
        if block is not None:
            item["resurfaced"] = True
        seen.add(identity)
        priorities.append(item)

    outreach: list[dict[str, Any]] = []
    seen_outreach: set[str] = set()
    for entry in payload.get("outreach") or []:
        if not isinstance(entry, dict):
            continue
        item = dict(entry)
        identity = outreach_identity(
            conversation_id=item.get("conversation_id"),
            lead_id=item.get("lead_id"),
            channel=_text(item.get("channel")),
            message_excerpt=str(item.get("message_excerpt") or ""),
        )
        item["item_key"] = identity
        if _references_unknown_entity(item, known):
            continue
        block = suppressed.get(identity)
        if block is not None:
            hidden.append(_hidden_entry(item, block, item_kind="outreach"))
            continue
        if identity in seen_outreach:
            continue
        seen_outreach.add(identity)
        outreach.append(item)

    priorities = _cover_today_instructions(
        priorities,
        context.get("today_instructions"),
        suppressed,
        hidden,
    )
    result = dict(payload)
    result["priorities"] = priorities
    result["outreach"] = outreach
    result["suppressed_items"] = hidden
    return result


def _cover_today_instructions(
    priorities: list[dict[str, Any]],
    raw_instructions: Any,
    suppressed: dict[str, dict[str, Any]],
    hidden: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not isinstance(raw_instructions, list):
        return priorities
    for instruction in raw_instructions:
        if not isinstance(instruction, dict):
            continue
        text = str(instruction.get("text") or "").strip()
        instruction_id = uuid_text(instruction.get("id"))
        if not text or instruction_id is None:
            continue
        matched = [
            item
            for item in priorities
            if _covers_instruction(item, text, instruction_id)
        ]
        if matched:
            for item in matched:
                item.setdefault("instruction_id", instruction_id)
            continue
        identity = f"instruction:{instruction_id}"
        block = suppressed.get(identity)
        fallback = {
            "title": text[:180],
            "why": "You asked to include this today.",
            "action": text,
            "lead_id": None,
            "invoice_id": None,
            "conversation_id": None,
            "channel": None,
            "kind": None,
            "urgency": 1,
            "sources": ["instruction"],
            "assigned_to": None,
            "done": False,
            "instruction_id": instruction_id,
            "from_instruction": True,
            "resurfaced": False,
            "item_key": identity,
        }
        if block is not None:
            hidden.append(_hidden_entry(fallback, block, item_kind="priority"))
            continue
        priorities.insert(0, fallback)
    return priorities


def _covers_instruction(item: dict[str, Any], text: str, instruction_id: str) -> bool:
    if uuid_text(item.get("instruction_id")) == instruction_id:
        return True
    needle = normalize_title(text)
    if len(needle) < _MIN_INSTRUCTION_MATCH:
        return False
    haystack = normalize_title(f"{item.get('title') or ''} {item.get('action') or ''}")
    if needle in haystack:
        return True
    return len(haystack) >= _MIN_INSTRUCTION_MATCH and haystack in needle


def _suppressed_index(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, list):
        return {}
    indexed: dict[str, dict[str, Any]] = {}
    for entry in value:
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("item_key") or "").strip()
        reason = str(entry.get("reason") or "").strip()
        if key and reason in _SUPPRESSED_REASONS:
            indexed[key] = entry
    return indexed


def _known_entities(context: dict[str, Any]) -> dict[str, set[str] | None]:
    return {
        "invoice_id": _ids(context.get("unpaid_invoices")),
        "conversation_id": _ids(
            context.get("needs_reply_threads"), field="conversation_id"
        ),
        "lead_id": _lead_ids(context),
    }


def _ids(value: Any, *, field: str = "id") -> set[str] | None:
    if not isinstance(value, list):
        return None
    found: set[str] = set()
    for entry in value:
        if not isinstance(entry, dict):
            continue
        parsed = uuid_text(entry.get(field))
        if parsed:
            found.add(parsed)
    return found


def _lead_ids(context: dict[str, Any]) -> set[str] | None:
    buckets = (
        context.get("open_leads"),
        context.get("recent_closed_leads"),
        context.get("converted_nurture"),
    )
    if any(not isinstance(bucket, list) for bucket in buckets):
        present = [bucket for bucket in buckets if isinstance(bucket, list)]
        if not present:
            return None
    found: set[str] = set()
    for bucket in buckets:
        if not isinstance(bucket, list):
            continue
        ids = _ids(bucket)
        if ids:
            found.update(ids)
    return found


def _activity_index(context: dict[str, Any]) -> dict[str, dict[str, datetime]]:
    return {
        "invoice_id": _times(
            context.get("unpaid_invoices"), field="id", stamp="updated_at"
        ),
        "conversation_id": _times(
            context.get("needs_reply_threads"),
            field="conversation_id",
            stamp="sent_at",
        ),
        "lead_id": _lead_times(context),
    }


def _lead_times(context: dict[str, Any]) -> dict[str, datetime]:
    times: dict[str, datetime] = {}
    for key in ("open_leads", "recent_closed_leads", "converted_nurture"):
        times.update(_times(context.get(key), field="id", stamp="updated_at"))
    return times


def _times(value: Any, *, field: str, stamp: str) -> dict[str, datetime]:
    if not isinstance(value, list):
        return {}
    times: dict[str, datetime] = {}
    for entry in value:
        if not isinstance(entry, dict):
            continue
        entity_id = uuid_text(entry.get(field))
        parsed = _parse_iso(entry.get(stamp))
        if entity_id and parsed is not None:
            times[entity_id] = parsed
    return times


def _references_unknown_entity(
    item: dict[str, Any], known: dict[str, set[str] | None]
) -> bool:
    for field, allowed in known.items():
        if allowed is None:
            continue
        entity_id = uuid_text(item.get(field))
        if entity_id and entity_id not in allowed:
            return True
    return False


def _resurfaced(
    item: dict[str, Any],
    block: dict[str, Any],
    activity: dict[str, dict[str, datetime]],
) -> bool:
    if str(block.get("reason") or "") != "done_today":
        return False
    done_at = _parse_iso(block.get("done_at"))
    if done_at is None:
        return False
    latest = _latest_activity(item, activity)
    return latest is not None and latest > done_at


def _latest_activity(
    item: dict[str, Any], activity: dict[str, dict[str, datetime]]
) -> datetime | None:
    stamps: list[datetime] = []
    for field, times in activity.items():
        entity_id = uuid_text(item.get(field))
        if entity_id and entity_id in times:
            stamps.append(times[entity_id])
    if not stamps:
        return None
    return max(stamps)


def _hidden_entry(
    item: dict[str, Any], block: dict[str, Any], *, item_kind: str
) -> dict[str, Any]:
    title = str(item.get("title") or block.get("title") or "").strip()
    if not title:
        title = str(item.get("message_excerpt") or "Hidden item").strip()
    return {
        "title": title,
        "item_key": str(item.get("item_key") or block.get("item_key") or ""),
        "item_kind": item_kind,
        "reason": str(block.get("reason") or ""),
        "lead_id": item.get("lead_id") or block.get("lead_id"),
        "invoice_id": item.get("invoice_id") or block.get("invoice_id"),
    }


def _prefer_higher_urgency(
    priorities: list[dict[str, Any]], identity: str, candidate: dict[str, Any]
) -> None:
    for index, current in enumerate(priorities):
        if current.get("item_key") != identity:
            continue
        if _urgency(candidate) < _urgency(current):
            priorities[index] = candidate
        return


def _urgency(item: dict[str, Any]) -> int:
    raw = item.get("urgency")
    if raw is None or isinstance(raw, bool):
        return 2
    try:
        parsed = int(raw)
    except (TypeError, ValueError):
        return 2
    return parsed if parsed in {1, 2, 3} else 2


def _parse_iso(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return as_utc(parsed)


def _text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None
