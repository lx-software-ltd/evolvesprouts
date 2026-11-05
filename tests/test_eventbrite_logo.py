"""Eventbrite header-image upload."""

from __future__ import annotations

import struct
import zlib
from typing import Any

from app.services import eventbrite_logo
from app.services.eventbrite_client import EventbriteApiError
from app.services.eventbrite_sync import (
    _compute_instance_hash,
    sync_instance_to_eventbrite,
)

from tests.eventbrite_sync_fakes import (
    _install_sync_fakes,
    _Session,
    _workshop,
)

_UPLOAD_URL = "https://s3.amazonaws.com/eventbrite-uploader-incoming-prod/"


def _png(width: int, height: int, pixel: bytes = b"\x00\x00\x00") -> bytes:
    def _chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = b"".join(b"\x00" + pixel * width for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(raw))
        + _chunk(b"IEND", b"")
    )


def _banner(tmp_path: Any, pixel: bytes = b"\x00\x00\x00") -> None:
    directory = tmp_path / "banners"
    directory.mkdir(exist_ok=True)
    (directory / "sample-workshop.png").write_bytes(_png(4, 2, pixel))


def _patch_media(
    monkeypatch: Any,
    *,
    upload_url: str = _UPLOAD_URL,
    upload_status: int = 204,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    media_calls: list[dict[str, Any]] = []
    uploads: list[dict[str, Any]] = []

    def _request(**kwargs: Any) -> dict[str, Any]:
        media_calls.append(kwargs)
        path = str(kwargs["path"])
        if path.startswith("/media/upload/?"):
            return {
                "upload_method": "POST",
                "upload_token": "token-1",
                "upload_url": upload_url,
                "upload_data": {"key": "abc", "policy": "secret-policy"},
                "file_parameter_name": "file",
            }
        if path == "/media/upload/":
            return {"id": "logo-9"}
        raise AssertionError(path)

    def _http(**kwargs: Any) -> dict[str, Any]:
        uploads.append(kwargs)
        return {"status": upload_status, "headers": {}, "body": ""}

    monkeypatch.setattr(eventbrite_logo, "eventbrite_request", _request)
    monkeypatch.setattr(eventbrite_logo, "http_invoke", _http)
    return media_calls, uploads


def test_sync_uploads_banner_before_the_event_update(
    monkeypatch: Any, tmp_path: Any
) -> None:
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _UPLOAD_URL)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    calls = _install_sync_fakes(monkeypatch, instance)
    media_calls, uploads = _patch_media(monkeypatch)

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert instance.eventbrite_last_payload_hash == _compute_instance_hash(instance)
    assert [call["path"] for call in calls] == [
        "/organizations/org-1/events/",
        "/events/1001/",
        "/events/1001/",
        "/events/1001/ticket_classes/",
        "/events/1001/publish/",
    ]
    assert calls[2]["payload"]["event"]["logo_id"] == "logo-9"
    assert "logo_id" not in calls[0]["payload"]["event"]
    calls.clear()
    second = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)
    assert second["status"] == "noop"
    assert calls == []
    assert [call["path"] for call in media_calls] == [
        "/media/upload/?type=image-event-logo",
        "/media/upload/",
    ]
    crop = media_calls[1]["payload"]["crop_mask"]
    assert crop == {"top_left": {"x": 0, "y": 0}, "width": 4, "height": 2}
    body = uploads[0]["body_bytes"]
    assert body.index(b'name="key"') < body.index(b'name="file"')
    assert body.index(b"secret-policy") < body.index(b"\x89PNG")
    assert b'filename="sample-workshop.png"' in body
    assert uploads[0]["url"] == _UPLOAD_URL


def test_wrong_upload_url_is_refused_and_sync_continues(
    monkeypatch: Any, tmp_path: Any
) -> None:
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _UPLOAD_URL)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    calls = _install_sync_fakes(monkeypatch, instance)
    warnings: list[dict[str, Any]] = []
    monkeypatch.setattr(
        eventbrite_logo.logger,
        "warning",
        lambda *_args, **kwargs: warnings.append(kwargs.get("extra") or {}),
    )
    _media_calls, uploads = _patch_media(
        monkeypatch, upload_url="https://evil.example/bucket/"
    )

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert uploads == []
    assert "logo_id" not in calls[2]["payload"]["event"]
    assert warnings
    assert all("secret-policy" not in str(extra) for extra in warnings)
    assert instance.eventbrite_last_payload_hash != _compute_instance_hash(instance)


def test_failed_upload_does_not_fail_the_sync(monkeypatch: Any, tmp_path: Any) -> None:
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _UPLOAD_URL)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    calls = _install_sync_fakes(monkeypatch, instance)
    warnings: list[dict[str, Any]] = []
    monkeypatch.setattr(
        eventbrite_logo.logger,
        "warning",
        lambda *_args, **kwargs: warnings.append(kwargs.get("extra") or {}),
    )
    media_calls, uploads = _patch_media(monkeypatch, upload_status=500)

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert "logo_id" not in calls[2]["payload"]["event"]
    assert instance.eventbrite_sync_status.value == "synced"
    assert warnings[0]["status"] == 500
    assert "message" not in warnings[0]
    assert "secret-policy" not in str(warnings)
    assert instance.eventbrite_last_payload_hash != _compute_instance_hash(instance)

    calls.clear()
    media_calls.clear()
    uploads.clear()
    second = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert second["status"] == "synced"
    assert media_calls[0]["path"] == "/media/upload/?type=image-event-logo"
    assert uploads[0]["url"] == _UPLOAD_URL


def test_logo_warning_includes_the_eventbrite_message(
    monkeypatch: Any, tmp_path: Any
) -> None:
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _UPLOAD_URL)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    _install_sync_fakes(monkeypatch, instance)
    warnings: list[dict[str, Any]] = []
    monkeypatch.setattr(
        eventbrite_logo.logger,
        "warning",
        lambda *_args, **kwargs: warnings.append(kwargs.get("extra") or {}),
    )

    def _reject(**_kwargs: Any) -> dict[str, Any]:
        raise EventbriteApiError(
            status_code=400,
            message="Eventbrite API request failed (400): ARGUMENTS_ERROR",
        )

    monkeypatch.setattr(eventbrite_logo, "eventbrite_request", _reject)

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert warnings[0]["status"] == 400
    assert warnings[0]["message"] == (
        "Eventbrite API request failed (400): ARGUMENTS_ERROR"
    )
    assert "policy" not in warnings[0]["message"]


def test_hash_changes_only_when_a_banner_exists(
    monkeypatch: Any, tmp_path: Any
) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "missing"))
    without_banner = _compute_instance_hash(instance)

    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    with_banner = _compute_instance_hash(instance)
    _banner(tmp_path, b"\x01\x02\x03")
    changed = _compute_instance_hash(instance)

    assert without_banner != with_banner
    assert with_banner != changed


def test_hash_without_a_banner_ignores_other_banners(
    monkeypatch: Any, tmp_path: Any
) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "other-event"
    monkeypatch.delenv("EVENTBRITE_BANNERS_DIR", raising=False)
    without_directory = _compute_instance_hash(instance)
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    with_directory = _compute_instance_hash(instance)

    assert with_directory == without_directory
    assert eventbrite_logo.eventbrite_banner_sha256(instance) is None
