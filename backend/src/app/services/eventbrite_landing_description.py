"""Eventbrite overview HTML from public landing-page JSON."""

from __future__ import annotations

import html
import json
import os
from pathlib import Path
from typing import Any

from app.utils.logging import get_logger
from app.utils.public_slug import PUBLIC_INSTANCE_SLUG_PATTERN

logger = get_logger(__name__)

_ENV_LANDING_PAGES_DIR = "EVENTBRITE_LANDING_PAGES_DIR"
_MAX_HTML_CHARS = 60000
# Eventbrite strips heading margins and CSS, so an empty line doubles the gap.
_TITLE_SPACER = "<p><br></p>"


def eventbrite_summary_text(instance: Any) -> str:
    """Short text Eventbrite shows above the overview."""
    return _short_description(instance)


def eventbrite_overview_html(instance: Any) -> str:
    """Structured-content HTML, or empty when no landing page matches."""
    page = _load_matching_page(instance)
    if page is None:
        return ""
    rendered = _render_page(page).strip()
    if not rendered:
        return ""
    if len(rendered) > _MAX_HTML_CHARS:
        logger.warning(
            "Landing page overview is too long for Eventbrite",
            extra={"slug": _instance_slug(instance), "length": len(rendered)},
        )
        return ""
    return rendered


def structured_content_payload(html_body: str) -> dict[str, Any]:
    """Body for ``POST /events/{id}/structured_content/{version}/``."""
    return {
        "modules": [
            {
                "type": "text",
                "data": {
                    "body": {
                        "alignment": "left",
                        "text": html_body,
                        "type": "text",
                    }
                },
            }
        ],
        "publish": True,
        "purpose": "listing",
    }


def next_structured_content_version(current: dict[str, Any]) -> int:
    """Version to publish. Eventbrite starts at 1 and only accepts a new one."""
    raw = current.get("page_version_number")
    try:
        version = int(raw or 0)
    except (TypeError, ValueError):
        version = 0
    return max(version, 0) + 1


def _short_description(instance: Any) -> str:
    description = str(getattr(instance, "description", "") or "").strip()
    if description:
        return description
    service = getattr(instance, "service", None)
    service_description = ""
    service_title = ""
    if service is not None:
        service_description = str(getattr(service, "description", "") or "").strip()
        service_title = str(getattr(service, "title", "") or "").strip()
    if service_description:
        return service_description
    title = str(getattr(instance, "title", "") or "").strip()
    return title or service_title


def _instance_slug(instance: Any) -> str:
    return str(getattr(instance, "slug", "") or "").strip()


def _landing_pages_dir() -> Path | None:
    override = os.getenv(_ENV_LANDING_PAGES_DIR, "").strip()
    if override:
        path = Path(override)
        if path.is_dir():
            return path
        logger.warning(
            "Eventbrite landing page directory is missing",
            extra={"env": _ENV_LANDING_PAGES_DIR},
        )
        return None

    module_path = Path(__file__).resolve()
    candidates = []
    if len(module_path.parents) > 3:
        candidates.append(module_path.parents[3] / "content" / "landing-pages")
    if len(module_path.parents) > 4:
        candidates.append(
            module_path.parents[4]
            / "apps"
            / "public_www"
            / "src"
            / "content"
            / "landing-pages"
        )
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return None


def _load_matching_page(instance: Any) -> dict[str, Any] | None:
    slug = _instance_slug(instance)
    directory = _landing_pages_dir()
    if directory is None:
        return None
    path = _page_path(directory, slug)
    if path is None:
        return None
    return _load_en_page(path, slug)


def _page_path(directory: Path, slug: str) -> Path | None:
    if not PUBLIC_INSTANCE_SLUG_PATTERN.fullmatch(slug):
        return None
    root = directory.resolve()
    candidate = (root / f"{slug}.json").resolve()
    if candidate.parent != root or not candidate.is_file():
        return None
    return candidate


def _load_en_page(path: Path, slug: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        logger.warning(
            "Eventbrite landing page JSON could not be read",
            extra={"slug": slug},
        )
        return None
    if not isinstance(payload, dict):
        return None
    page = payload.get("en")
    if not isinstance(page, dict):
        return None
    return page


def _render_page(page: dict[str, Any]) -> str:
    """Skip the hero. Eventbrite already shows that sentence as the summary."""
    parts = [
        _section(_mapping(page.get("outline"))),
        _section(_mapping(page.get("description"))),
        _section(_mapping(page.get("details"))),
        _section(_mapping(page.get("faq"))),
        _coach(_mapping(page.get("coach"))),
    ]
    return "".join(part for part in parts if part)


def _section(block: dict[str, Any]) -> str:
    title = _text(block.get("title"))
    body = _paragraphs(_text(block.get("description")))
    items = _item_list(block.get("items"))
    return f"{_heading(title)}{body}{items}"


def _heading(title: str) -> str:
    if not title:
        return ""
    return f"{_TITLE_SPACER}<h2>{html.escape(title)}</h2>"


def _coach(block: dict[str, Any]) -> str:
    eyebrow = _text(block.get("eyebrow")) or _text(block.get("title"))
    title = _text(block.get("title"))
    subtitle = _text(block.get("subtitle"))
    heading = _heading(eyebrow)
    name = ""
    if title and title != eyebrow:
        name = f"<p><strong>{html.escape(title)}</strong></p>"
    return (
        f"{heading}{name}{_paragraphs(subtitle)}{_paragraphs(_text(block.get('description')))}"
        f"{_string_list(block.get('tags'))}"
    )


def _item_list(value: Any) -> str:
    if not isinstance(value, list):
        return ""
    rows: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = _text(item.get("title") or item.get("question"))
        body = _text(item.get("description") or item.get("answer"))
        if title and body:
            rows.append(
                f"<li><strong>{html.escape(title)}</strong> {html.escape(body)}</li>"
            )
        elif title:
            rows.append(f"<li><strong>{html.escape(title)}</strong></li>")
        elif body:
            rows.append(f"<li>{html.escape(body)}</li>")
    if not rows:
        return ""
    return "<ul>" + "".join(rows) + "</ul>"


def _string_list(value: Any) -> str:
    if not isinstance(value, list):
        return ""
    rows: list[str] = []
    for item in value:
        text = _text(item)
        if text:
            rows.append(f"<li>{html.escape(text)}</li>")
    if not rows:
        return ""
    return "<ul>" + "".join(rows) + "</ul>"


def _paragraphs(text: str) -> str:
    if not text:
        return ""
    rendered: list[str] = []
    for block in text.split("\n\n"):
        cleaned = block.strip()
        if not cleaned:
            continue
        lines = "<br>".join(html.escape(line) for line in cleaned.split("\n"))
        rendered.append(f"<p>{lines}</p>")
    return "".join(rendered)


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()
