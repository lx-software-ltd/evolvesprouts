"""Eventbrite overview HTML built from landing-page JSON."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from app.services.eventbrite_landing_description import (
    eventbrite_overview_html,
    eventbrite_summary_text,
)
from app.services.eventbrite_sync import _build_event_payload, _compute_instance_hash

_FIXTURE = {
    "en": {
        "hero": {
            "description": "Lead line with <script>alert(1)</script>.",
        },
        "outline": {
            "title": "Why this room",
            "description": "First paragraph with <script>alert(1)</script>.\n\nSecond paragraph.",
        },
        "description": {
            "title": "What we work on",
            "description": "The short lead.",
            "items": [
                {
                    "title": "9:00 — Appetite",
                    "description": "Milk at ten.",
                }
            ],
        },
        "details": {
            "title": "How it works",
            "items": [
                {
                    "icon": "plate",
                    "title": "Saturday only",
                    "description": "Practice, not a lecture.",
                }
            ],
        },
        "faq": {
            "title": "Questions",
            "items": [
                {
                    "question": "Who comes?",
                    "answer": "Families with a helper.",
                }
            ],
        },
        "coach": {
            "eyebrow": "Your trainer",
            "title": "Alex Example",
            "subtitle": "Trainer",
            "description": "Trained for ages 0-3.",
            "tags": ["Example certificate"],
        },
        "cta": {
            "title": "Do not include this call to action",
            "buttonLabel": "Reserve my spot",
        },
    }
}


class _Service:
    def __init__(self) -> None:
        self.title = "Service title"
        self.description = "Service description"


class _Instance:
    def __init__(self, *, slug: str, description: str = "Short note") -> None:
        self.slug = slug
        self.title = "Instance title"
        self.description = description
        self.service = _Service()
        self.id = "instance-1"
        self.service_id = "service-1"
        self.status = type("Status", (), {"value": "open"})()
        self.delivery_mode = None
        self.session_slots: list[Any] = []
        self.ticket_tiers: list[Any] = []


def _write_page(directory: Path, slug: str, payload: dict[str, Any]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{slug}.json").write_text(
        json.dumps(payload),
        encoding="utf-8",
    )


def test_description_uses_landing_page_sections(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _write_page(tmp_path, "sample-workshop", _FIXTURE)
    monkeypatch.setenv("EVENTBRITE_LANDING_PAGES_DIR", str(tmp_path))

    html = eventbrite_overview_html(_Instance(slug="sample-workshop"))

    assert "Lead line" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "<h2>Why this room</h2>" in html
    assert "<p>Second paragraph.</p>" in html
    assert "<h2>What we work on</h2>" in html
    assert "<strong>9:00 — Appetite</strong>" in html
    assert "<h2>How it works</h2>" in html
    assert "<strong>Saturday only</strong>" in html
    assert "plate" not in html
    assert "<h2>Questions</h2>" in html
    assert "<strong>Who comes?</strong>" in html
    assert "<h2>Your trainer</h2>" in html
    assert "<strong>Alex Example</strong>" in html
    assert "Example certificate" in html
    assert "Reserve my spot" not in html
    assert "Do not include this call to action" not in html


def test_description_falls_back_when_slug_has_no_page(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("EVENTBRITE_LANDING_PAGES_DIR", str(tmp_path))

    instance = _Instance(slug="missing-page")

    assert eventbrite_overview_html(instance) == ""
    assert eventbrite_summary_text(instance) == "Short note"


def test_description_rejects_slug_outside_the_directory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    outside = tmp_path / "outside.json"
    outside.write_text(json.dumps(_FIXTURE), encoding="utf-8")
    pages = tmp_path / "pages"
    pages.mkdir()
    monkeypatch.setenv("EVENTBRITE_LANDING_PAGES_DIR", str(pages))

    html = eventbrite_overview_html(_Instance(slug="../outside"))

    assert html == ""
    assert "Why this room" not in html


def test_description_falls_back_when_json_is_invalid(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "broken-page.json").write_text("{", encoding="utf-8")
    monkeypatch.setenv("EVENTBRITE_LANDING_PAGES_DIR", str(tmp_path))

    html = eventbrite_overview_html(_Instance(slug="broken-page"))

    assert html == ""


def test_hash_changes_when_landing_copy_changes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    _write_page(first, "sample-workshop", _FIXTURE)
    edited = json.loads(json.dumps(_FIXTURE))
    edited["en"]["outline"]["description"] = "A different paragraph."
    _write_page(second, "sample-workshop", edited)
    instance = _Instance(slug="sample-workshop")

    monkeypatch.setenv("EVENTBRITE_LANDING_PAGES_DIR", str(first))
    first_hash = _compute_instance_hash(instance)
    monkeypatch.setenv("EVENTBRITE_LANDING_PAGES_DIR", str(second))
    second_hash = _compute_instance_hash(instance)

    assert first_hash != second_hash


def test_hash_without_a_landing_page_ignores_other_pages(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _write_page(tmp_path, "sample-workshop", _FIXTURE)
    instance = _Instance(slug="other-event")
    monkeypatch.setenv("EVENTBRITE_LANDING_PAGES_DIR", str(tmp_path))
    with_directory = _compute_instance_hash(instance)
    monkeypatch.delenv("EVENTBRITE_LANDING_PAGES_DIR", raising=False)
    without_directory = _compute_instance_hash(instance)

    assert with_directory == without_directory


def test_real_mealtimes_page_fills_overview(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EVENTBRITE_LANDING_PAGES_DIR", raising=False)
    instance = _Instance(
        slug="nov-2026-mealtimes-workshop",
        description="Short note",
    )

    html = eventbrite_overview_html(instance)

    assert html != ""
    assert "Two hours on the thing that decides" not in html
    assert "The child who won&#x27;t eat" in html or "The child who won't eat" in html
    assert "Building the plate" in html
    assert "Who is it for?" in html
    assert "Reserve my spot" not in html


def test_build_event_payload_uses_landing_html(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from datetime import UTC, datetime
    from decimal import Decimal
    from uuid import uuid4

    from app.db.models import InstanceStatus, ServiceDeliveryMode, ServiceType

    _write_page(tmp_path, "sample-workshop", _FIXTURE)
    monkeypatch.setenv("EVENTBRITE_LANDING_PAGES_DIR", str(tmp_path))
    monkeypatch.delenv("EVENTBRITE_DEFAULT_TIMEZONE", raising=False)

    class _Slot:
        def __init__(self) -> None:
            self.id = uuid4()
            self.starts_at = datetime(2026, 11, 20, 10, 0, tzinfo=UTC)
            self.ends_at = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
            self.sort_order = 0

    class _Tier:
        def __init__(self) -> None:
            self.currency = "HKD"
            self.price = Decimal("150.00")

    class _EventService:
        def __init__(self) -> None:
            self.service_type = ServiceType.EVENT
            self.title = "Workshop"
            self.description = "A workshop"
            self.delivery_mode = ServiceDeliveryMode.IN_PERSON

    class _EventInstance:
        def __init__(self) -> None:
            self.slug = "sample-workshop"
            self.title = "Mealtime Workshop"
            self.description = "Short note"
            self.service = _EventService()
            self.delivery_mode = None
            self.status = InstanceStatus.OPEN
            self.session_slots = [_Slot()]
            self.ticket_tiers = [_Tier()]

    payload = _build_event_payload(_EventInstance())

    assert payload["description"]["html"] == "Short note"
    assert "<h2>Why this room</h2>" in eventbrite_overview_html(_EventInstance())
    assert payload["name"]["html"] == "Mealtime Workshop"
