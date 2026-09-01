"""Tests for WhatsApp Business App export parsing."""

from __future__ import annotations

import io
import zipfile

import pytest

from app.services.whatsapp_export_import import import_parsed_whatsapp_chats
from app.services.whatsapp_export_parse import parse_whatsapp_export


def test_parse_android_transcript_extracts_phone_from_filename() -> None:
    text = (
        "13/08/2024, 14:32 - +852 9123 4567: Hello there\n"
        "13/08/2024, 14:33 - Evolve Sprouts: Hi!\n"
        "continued on next line\n"
    ).encode("utf-8")
    chats = parse_whatsapp_export(
        text,
        filename="WhatsApp Chat with +852 9123 4567.txt",
        content_type="text/plain",
    )
    assert len(chats) == 1
    assert chats[0].counterparty_hint == "85291234567"
    assert len(chats[0].messages) == 2
    assert chats[0].messages[0].body == "Hello there"
    assert chats[0].messages[1].body == "Hi!\ncontinued on next line"


def test_parse_zip_reads_chat_txt() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "_chat.txt",
            "[13/08/2024, 14:32:05] Jane: Ping\n",
        )
        archive.writestr("IMG-1.jpg", b"not-a-chat")
    chats = parse_whatsapp_export(
        buffer.getvalue(),
        filename="export.zip",
        content_type="application/zip",
    )
    assert len(chats) == 1
    assert chats[0].messages[0].body == "Ping"


def test_import_uses_business_names_as_outbound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace
    from uuid import uuid4

    from app.services import whatsapp_export_import as importer

    stored: list[object] = []

    def _store(_session: object, **kwargs: object) -> None:
        stored.append(kwargs)
        counters = kwargs["counters"]
        if isinstance(counters, dict):
            counters["stored"] = int(counters.get("stored") or 0) + 1

    monkeypatch.setattr(importer, "store_whatsapp_message", _store)  # type: ignore[attr-defined]
    chats = parse_whatsapp_export(
        (
            "13/08/2024, 14:32 - Jane Doe: Hello\n"
            "13/08/2024, 14:33 - Studio: Welcome\n"
        ).encode("utf-8"),
        filename="WhatsApp Chat with Jane Doe.txt",
    )
    counters = import_parsed_whatsapp_chats(
        SimpleNamespace(id=uuid4()),
        chats,
        counterparty_wa_id="85291112222",
        business_display_names=["Studio"],
    )
    assert counters["stored"] == 2
    assert stored[0]["direction"].value == "inbound"
    assert stored[1]["direction"].value == "outbound"
