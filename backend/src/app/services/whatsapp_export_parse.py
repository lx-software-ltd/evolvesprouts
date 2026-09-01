"""Parse WhatsApp Business App chat exports (``.txt`` or ``.zip``)."""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from app.exceptions import ValidationError

_MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
_MAX_CHAT_FILES = 200
_MAX_CHAT_TEXT_BYTES = 8 * 1024 * 1024

# Android: 13/08/2024, 14:32 - Name: body
# iOS: [13/08/2024, 14:32:05] Name: body
_ANDROID_LINE = re.compile(
    r"^(?P<date>\d{1,4}[/-]\d{1,2}[/-]\d{1,4}),?\s+"
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\s+-\s+"
    r"(?P<sender>[^:]+):\s*(?P<body>.*)$"
)
_IOS_LINE = re.compile(
    r"^\[(?P<date>\d{1,4}[/-]\d{1,2}[/-]\d{1,4}),\s+"
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\]\s+"
    r"(?P<sender>[^:]+):\s*(?P<body>.*)$"
)
_PHONE_RE = re.compile(r"\+?\d[\d\s\-()]{6,}\d")
_CHAT_FILENAME = re.compile(r"whatsapp chat with (.+)\.txt$", re.IGNORECASE)


@dataclass(frozen=True)
class ParsedExportMessage:
    """One parsed WhatsApp export line."""

    sender: str
    sent_at: datetime
    body: str | None
    message_type: str


@dataclass(frozen=True)
class ParsedExportChat:
    """One exported 1:1 chat."""

    title: str
    filename: str
    counterparty_hint: str | None
    messages: tuple[ParsedExportMessage, ...]


def parse_whatsapp_export(
    raw_bytes: bytes,
    *,
    filename: str,
    content_type: str | None = None,
) -> list[ParsedExportChat]:
    """Parse a chat ``.txt`` or a zip of chat transcripts (media files ignored)."""
    if len(raw_bytes) > _MAX_ARCHIVE_BYTES:
        raise ValidationError("WhatsApp export is too large", field="attachment_asset_id")
    lowered = filename.lower()
    mime = (content_type or "").lower()
    if lowered.endswith(".zip") or "zip" in mime:
        return _parse_zip(raw_bytes)
    if lowered.endswith(".txt") or mime.startswith("text/"):
        return [_parse_chat_text(raw_bytes, filename=filename)]
    raise ValidationError(
        "WhatsApp export must be a .txt transcript or .zip of transcripts",
        field="attachment_asset_id",
    )


def extract_phone_hint(value: str | None) -> str | None:
    """Return the first phone-like token from a filename or sender, digits only."""
    if not value:
        return None
    match = _PHONE_RE.search(value)
    if match is None:
        return None
    digits = re.sub(r"\D", "", match.group(0))
    return digits or None


def _parse_zip(raw_bytes: bytes) -> list[ParsedExportChat]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw_bytes))
    except zipfile.BadZipFile as exc:
        raise ValidationError(
            "WhatsApp export zip is not valid", field="attachment_asset_id"
        ) from exc
    chats: list[ParsedExportChat] = []
    names = [name for name in archive.namelist() if _is_chat_member(name)]
    if len(names) > _MAX_CHAT_FILES:
        raise ValidationError(
            "WhatsApp export zip has too many chat files",
            field="attachment_asset_id",
        )
    for name in names:
        info = archive.getinfo(name)
        if info.file_size > _MAX_CHAT_TEXT_BYTES:
            raise ValidationError(
                "WhatsApp chat transcript is too large",
                field="attachment_asset_id",
            )
        payload = archive.read(name)
        chats.append(_parse_chat_text(payload, filename=name.rsplit("/", 1)[-1]))
    if not chats:
        raise ValidationError(
            "WhatsApp export zip did not contain a chat transcript",
            field="attachment_asset_id",
        )
    return chats


def _is_chat_member(name: str) -> bool:
    base = name.rsplit("/", 1)[-1].lower()
    if base.startswith(".") or name.endswith("/"):
        return False
    return base == "_chat.txt" or base.startswith("whatsapp chat with ")


def _parse_chat_text(raw_bytes: bytes, *, filename: str) -> ParsedExportChat:
    text = _decode_text(raw_bytes)
    messages: list[ParsedExportMessage] = []
    current: ParsedExportMessage | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip("\ufeff").rstrip()
        parsed = _parse_message_line(line)
        if parsed is not None:
            if current is not None:
                messages.append(current)
            current = parsed
            continue
        if current is not None and line:
            extra = f"{current.body}\n{line}" if current.body else line
            current = ParsedExportMessage(
                sender=current.sender,
                sent_at=current.sent_at,
                body=extra,
                message_type=current.message_type,
            )
    if current is not None:
        messages.append(current)
    title = _title_from_filename(filename)
    return ParsedExportChat(
        title=title,
        filename=filename,
        counterparty_hint=extract_phone_hint(title) or extract_phone_hint(filename),
        messages=tuple(messages),
    )


def _parse_message_line(line: str) -> ParsedExportMessage | None:
    match = _IOS_LINE.match(line) or _ANDROID_LINE.match(line)
    if match is None:
        return None
    sent_at = _parse_export_datetime(match.group("date"), match.group("time"))
    if sent_at is None:
        return None
    sender = match.group("sender").strip()
    body = match.group("body").strip()
    message_type = "text"
    if not body:
        body_value = None
    elif body.lower() in {"<media omitted>", "image omitted", "video omitted"}:
        message_type = "media"
        body_value = "[media]"
    elif body.endswith("(file attached)"):
        message_type = "media"
        body_value = body
    else:
        body_value = body
    return ParsedExportMessage(
        sender=sender,
        sent_at=sent_at,
        body=body_value,
        message_type=message_type,
    )


def _parse_export_datetime(date_text: str, time_text: str) -> datetime | None:
    date_text = date_text.strip()
    time_text = time_text.strip()
    candidates = (
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%y %H:%M",
        "%d/%m/%y %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%m/%d/%Y %I:%M %p",
        "%m/%d/%y %I:%M:%S %p",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d-%m-%Y %H:%M:%S",
    )
    stamp = f"{date_text} {time_text.replace('.', ':')}"
    stamp = re.sub(r"\s+", " ", stamp)
    for fmt in candidates:
        try:
            parsed = datetime.strptime(stamp, fmt)
        except ValueError:
            continue
        return parsed.replace(tzinfo=timezone.utc)
    return None


def _title_from_filename(filename: str) -> str:
    base = filename.rsplit("/", 1)[-1]
    match = _CHAT_FILENAME.search(base)
    if match:
        return match.group(1).strip()
    if base.lower() == "_chat.txt":
        return "WhatsApp chat"
    return base.removesuffix(".txt").strip() or "WhatsApp chat"


def _decode_text(raw_bytes: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "utf-16", "latin-1"):
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw_bytes.decode("utf-8", errors="replace")

