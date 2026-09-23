"""Admin completion certificate API tests."""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import uuid4

import pytest

from app.api.admin_completion_certificates import (
    _parse_issue_payload,
    handle_admin_completion_certificates_request,
)
from app.exceptions import AppError, ValidationError
from app.services.customer_billing import store_pdf_in_assets_bucket
from app.services.completion_certificate_pdf import (
    build_certificate_body_text,
    render_completion_certificate_pdf,
    CompletionCertificatePdfContext,
)


def test_build_certificate_body_text_with_partner() -> None:
    text = build_certificate_body_text(
        trading_name="Evolve Sprouts",
        partner_display_name="Parachute",
    )
    assert "Evolve Sprouts × Parachute" in text
    assert "Montessori-informed" in text


def test_render_completion_certificate_pdf_escapes_special_characters() -> None:
    pdf = render_completion_certificate_pdf(
        CompletionCertificatePdfContext(
            recipient_display_name="Alex & Co <test>",
            program_title="Program <title> & more",
            participation_date=date(2026, 6, 14),
            trading_name="Evolve Sprouts",
            partner_display_name=None,
            partner_signer_name=None,
            es_founder_name="Founder Example",
            body_text=build_certificate_body_text(
                trading_name="Evolve Sprouts",
                partner_display_name=None,
            ),
        )
    )
    assert pdf.startswith(b"%PDF")


def test_store_pdf_requires_assets_bucket_when_required(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ASSETS_BUCKET_NAME", raising=False)
    with pytest.raises(AppError, match="Assets bucket is not configured"):
        store_pdf_in_assets_bucket(
            s3_key="completion-certificates/test.pdf",
            body=b"%PDF-1.4",
            content_type="application/pdf",
            require_upload=True,
        )


def test_render_completion_certificate_pdf_returns_bytes() -> None:
    pdf = render_completion_certificate_pdf(
        CompletionCertificatePdfContext(
            recipient_display_name="Alex Example",
            program_title="Montessori Postnatal Caretaker",
            participation_date=date(2026, 6, 14),
            trading_name="Evolve Sprouts",
            partner_display_name="Parachute",
            partner_signer_name="Pat Example",
            es_founder_name="Founder Example",
            body_text=build_certificate_body_text(
                trading_name="Evolve Sprouts",
                partner_display_name="Parachute",
            ),
        )
    )
    assert pdf.startswith(b"%PDF")


def test_parse_issue_payload_requires_fields() -> None:
    with pytest.raises(ValidationError):
        _parse_issue_payload({})


def test_parse_issue_payload_parses_uuids_and_date() -> None:
    cid = uuid4()
    sid = uuid4()
    iid = uuid4()
    pid = uuid4()
    parsed = _parse_issue_payload(
        {
            "contact_id": str(cid),
            "service_id": str(sid),
            "instance_id": str(iid),
            "participation_date": "2026-06-14",
            "program_title": " Custom Program ",
            "partner_organization_id": str(pid),
        }
    )
    assert parsed["contact_id"] == cid
    assert parsed["participation_date"] == date(2026, 6, 14)
    assert parsed["program_title_override"] == "Custom Program"
    assert parsed["partner_organization_id"] == pid


def test_handle_unknown_route_returns_404(api_gateway_event: Any) -> None:
    response = handle_admin_completion_certificates_request(
        api_gateway_event(method="GET", path="/v1/admin/unknown"),
        "GET",
        "/v1/admin/unknown",
    )
    assert response["statusCode"] == 404
