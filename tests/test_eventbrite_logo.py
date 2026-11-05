"""Eventbrite header-image upload."""

from __future__ import annotations

import struct
import zlib
from typing import Any

import pytest
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
_IMAGE_UPLOAD_URL = "https://www.eventbrite.com/image-bff/api/upload"
_DEFAULT_UPLOAD_DATA: Any = object()


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
    upload_data: Any = _DEFAULT_UPLOAD_DATA,
    instructions: dict[str, Any] | None = None,
    created: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    media_calls: list[dict[str, Any]] = []
    uploads: list[dict[str, Any]] = []

    def _request(**kwargs: Any) -> dict[str, Any]:
        media_calls.append(kwargs)
        path = str(kwargs["path"])
        if path.startswith("/media/upload/?"):
            if instructions is not None:
                return dict(instructions)
            payload = {
                "upload_method": "POST",
                "upload_token": "token-1",
                "upload_url": upload_url,
                "file_parameter_name": "file",
            }
            if upload_data is _DEFAULT_UPLOAD_DATA:
                payload["upload_data"] = {"key": "abc", "policy": "secret-policy"}
            elif upload_data is not None:
                payload["upload_data"] = upload_data
            return payload
        if path == "/media/upload/":
            return dict(created) if created is not None else {"id": "logo-9"}
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
    assert warnings[0]["upload_url"] == "https://evil.example/bucket/"
    assert instance.eventbrite_last_payload_hash != _compute_instance_hash(instance)


@pytest.mark.parametrize(
    "returned",
    [
        "https://s3.amazonaws.com/eventbrite-uploader-incoming-prod",
        "https://eventbrite-uploader-incoming-prod.s3.amazonaws.com/",
        "https://eventbrite-uploader-incoming-prod.s3.amazonaws.com",
        "https://eventbrite-uploader-incoming-prod.s3.us-east-1.amazonaws.com/",
        "https://s3.us-east-1.amazonaws.com/eventbrite-uploader-incoming-prod/",
        "https://S3.AMAZONAWS.COM/eventbrite-uploader-incoming-prod/",
    ],
)
def test_same_bucket_in_another_form_uploads_to_the_configured_url(
    monkeypatch: Any, tmp_path: Any, returned: str
) -> None:
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _UPLOAD_URL)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    calls = _install_sync_fakes(monkeypatch, instance)
    _media_calls, uploads = _patch_media(monkeypatch, upload_url=returned)

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert uploads[0]["url"] == _UPLOAD_URL
    assert calls[2]["payload"]["event"]["logo_id"] == "logo-9"


@pytest.mark.parametrize("upload_data", [{}, None])
@pytest.mark.parametrize(
    "returned",
    [
        _IMAGE_UPLOAD_URL,
        f"{_IMAGE_UPLOAD_URL}/",
        "https://WWW.EVENTBRITE.COM/image-bff/api/upload/",
    ],
)
def test_image_bff_url_uploads_to_the_configured_url(
    monkeypatch: Any, tmp_path: Any, returned: str, upload_data: Any
) -> None:
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _IMAGE_UPLOAD_URL)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    calls = _install_sync_fakes(monkeypatch, instance)
    _media_calls, uploads = _patch_media(
        monkeypatch, upload_url=returned, upload_data=upload_data
    )

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert uploads[0]["url"] == _IMAGE_UPLOAD_URL
    assert b'name="file"' in uploads[0]["body_bytes"]
    assert b"secret-policy" not in uploads[0]["body_bytes"]
    assert calls[2]["payload"]["event"]["logo_id"] == "logo-9"


def test_signed_bucket_uploads_to_s3_when_the_advertised_url_is_a_stub(
    monkeypatch: Any, tmp_path: Any
) -> None:
    """Eventbrite advertises image-bff, which accepts anything and stores nothing."""
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _UPLOAD_URL)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    calls = _install_sync_fakes(monkeypatch, instance)
    _media_calls, uploads = _patch_media(
        monkeypatch,
        upload_url=_IMAGE_UPLOAD_URL,
        upload_data={
            "AWSAccessKeyId": "AKIA",
            "bucket": "eventbrite-uploader-incoming-prod",
            "acl": "private",
            "key": "abc",
            "policy": "secret-policy",
            "signature": "sig",
        },
    )

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert uploads[0]["url"] == _UPLOAD_URL
    body = uploads[0]["body_bytes"]
    assert body.index(b'name="bucket"') < body.index(b'name="file"')
    assert calls[2]["payload"]["event"]["logo_id"] == "logo-9"
    assert instance.eventbrite_last_payload_hash == _compute_instance_hash(instance)


def test_other_signed_bucket_is_refused(monkeypatch: Any, tmp_path: Any) -> None:
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
        monkeypatch,
        upload_url=_IMAGE_UPLOAD_URL,
        upload_data={"bucket": "other-bucket", "policy": "secret-policy"},
    )

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert uploads == []
    assert "logo_id" not in calls[2]["payload"]["event"]
    assert warnings[0]["upload_url"] == _IMAGE_UPLOAD_URL
    assert warnings[0]["bucket"] == "other-bucket"
    assert "secret-policy" not in str(warnings)


def test_hash_changes_with_the_upload_url(monkeypatch: Any, tmp_path: Any) -> None:
    """A new upload target resends the banner, replacing a dead image."""
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _IMAGE_UPLOAD_URL)
    via_stub = _compute_instance_hash(instance)
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _UPLOAD_URL)
    via_bucket = _compute_instance_hash(instance)
    again = _compute_instance_hash(instance)

    assert via_stub != via_bucket
    assert via_bucket == again


def test_sparse_instructions_still_upload(monkeypatch: Any, tmp_path: Any) -> None:
    """No method, no file field name, a wrapped policy, and a numeric field."""
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _IMAGE_UPLOAD_URL)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    calls = _install_sync_fakes(monkeypatch, instance)
    media_calls, uploads = _patch_media(
        monkeypatch,
        instructions={
            "upload_token": " token-2 ",
            "upload_url": _IMAGE_UPLOAD_URL,
            "upload_data": {
                "policy": "line-one\nline-two",
                "success_action_status": 201,
                "key": "abc",
            },
        },
        created={"image": {"id": "logo-10"}},
    )

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    body = uploads[0]["body_bytes"]
    assert b"line-one\nline-two" in body
    assert b'name="success_action_status"\r\n\r\n201\r\n' in body
    assert body.index(b'name="key"') < body.index(b'name="file"')
    assert media_calls[1]["payload"]["upload_token"] == "token-2"
    assert calls[2]["payload"]["event"]["logo_id"] == "logo-10"


@pytest.mark.parametrize(
    ("instructions", "reason"),
    [
        (
            {"upload_method": "PUT", "upload_token": "t", "upload_url": "URL"},
            "upload method is not POST",
        ),
        (
            {"upload_url": "URL", "upload_data": {"key": "abc"}},
            "upload token is missing",
        ),
        (
            {"upload_token": "t", "upload_url": "URL", "upload_data": {"a b": "x"}},
            "upload field name is not allowed",
        ),
        (
            {"upload_token": "t", "upload_url": "URL", "upload_data": {"key": None}},
            "upload field value is not text",
        ),
        (
            {"upload_token": "t", "upload_url": "URL", "upload_data": ["key"]},
            "upload fields are not an object",
        ),
        (
            {"upload_token": "t", "upload_url": "URL", "file_parameter_name": "a b"},
            "file field name is not allowed",
        ),
    ],
)
def test_bad_instructions_log_the_reason_and_field_names(
    monkeypatch: Any, tmp_path: Any, instructions: dict[str, Any], reason: str
) -> None:
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _IMAGE_UPLOAD_URL)
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
    payload = {
        key: (_IMAGE_UPLOAD_URL if value == "URL" else value)
        for key, value in instructions.items()
    }
    _media_calls, uploads = _patch_media(monkeypatch, instructions=payload)

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert uploads == []
    assert "logo_id" not in calls[2]["payload"]["event"]
    assert warnings[0]["reason"] == reason
    assert warnings[0]["instruction_keys"] == sorted(payload)
    assert "status" not in warnings[0]
    assert instance.eventbrite_last_payload_hash != _compute_instance_hash(instance)


def test_finalize_without_an_id_logs_the_reason(
    monkeypatch: Any, tmp_path: Any
) -> None:
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _IMAGE_UPLOAD_URL)
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
        monkeypatch, upload_url=_IMAGE_UPLOAD_URL, created={"url": "x"}
    )

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert len(uploads) == 1
    assert "logo_id" not in calls[2]["payload"]["event"]
    assert warnings[0]["reason"] == "upload response has no image id"
    assert warnings[0]["upload_fields"] == ["key", "policy"]


@pytest.mark.parametrize(
    "returned",
    [
        f"{_IMAGE_UPLOAD_URL}/extra",
        "https://www.eventbrite.com/image-bff/api/upload-other",
        f"{_IMAGE_UPLOAD_URL}?x=1",
        "https://evil.example/image-bff/api/upload",
    ],
)
def test_image_bff_lookalikes_are_refused(
    monkeypatch: Any, tmp_path: Any, returned: str
) -> None:
    _banner(tmp_path)
    monkeypatch.setenv("EVENTBRITE_BANNERS_DIR", str(tmp_path / "banners"))
    monkeypatch.setenv("EVENTBRITE_MEDIA_UPLOAD_URL", _IMAGE_UPLOAD_URL)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    calls = _install_sync_fakes(monkeypatch, instance)
    _media_calls, uploads = _patch_media(monkeypatch, upload_url=returned)

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert uploads == []
    assert "logo_id" not in calls[2]["payload"]["event"]


@pytest.mark.parametrize(
    "returned",
    [
        "http://s3.amazonaws.com/eventbrite-uploader-incoming-prod/",
        "https://s3.amazonaws.com/other-bucket/",
        "https://eventbrite-uploader-incoming-prod.s3.amazonaws.com.evil.example/",
        "https://other-bucket.s3.amazonaws.com/",
        "https://s3.amazonaws.com/eventbrite-uploader-incoming-prod/extra/",
        "https://user@s3.amazonaws.com/eventbrite-uploader-incoming-prod/",
        "https://s3.amazonaws.com:8443/eventbrite-uploader-incoming-prod/",
        "https://s3.amazonaws.com/eventbrite-uploader-incoming-prod/?x=1",
    ],
)
def test_other_upload_urls_are_refused(
    monkeypatch: Any, tmp_path: Any, returned: str
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
    _media_calls, uploads = _patch_media(monkeypatch, upload_url=returned)

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert uploads == []
    assert "logo_id" not in calls[2]["payload"]["event"]
    assert "?" not in warnings[0]["upload_url"]
    assert "@" not in warnings[0]["upload_url"]


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
    assert warnings[0]["upload_fields"] == ["key", "policy"]
    assert "message" not in warnings[0]
    assert "reason" not in warnings[0]
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
