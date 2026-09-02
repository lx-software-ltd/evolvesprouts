"""Booking confirmation email composition and delivery for public reservations."""

from __future__ import annotations

import os
from typing import Any

from app.api.public_form_hooks import normalize_body_locale
from app.services.email import (
    send_mime_email_with_optional_attachments,
    send_templated_email,
)
from app.templates.booking_confirmation_content import BOOKING_ICS_ATTACHMENT_FILENAME
from app.templates.booking_confirmation_render import (
    booking_confirmation_template_merge_data,
    build_booking_confirmation_ics,
    format_booking_location_display_line,
    intro_call_confirmation_template_merge_data,
    render_booking_confirmation_email,
    render_intro_call_confirmation_email,
    substitute_shell_placeholders,
)
from app.templates.transactional_shell_data import (
    merge_transactional_shell_template_data,
    resolve_whatsapp_url_for_template,
)
from app.utils.fps_qr_png import (
    decode_fps_qr_png_data_url,
)
from app.utils.logging import get_logger, mask_email

logger = get_logger(__name__)


def send_booking_confirmation_email(
    *,
    to_email: str,
    full_name: str,
    title: str,
    service_key: str | None = None,
    service_type: str | None = None,
    schedule_date: str | None,
    schedule_time: str | None,
    location_name: str | None = None,
    location_address: str | None = None,
    primary_session_iso: str | None = None,
    primary_session_end_iso: str | None = None,
    booking_system: str | None = None,
    service_tier_label: str | None = None,
    payment_method: str,
    total_amount: str,
    is_pending_payment: bool,
    locale: str,
    fps_qr_image_data_url: str | None = None,
    consultation_writing_focus_label: str | None = None,
    consultation_level_label: str | None = None,
    session_slots: list[dict[str, str]] | None = None,
    location_url: str | None = None,
    is_free: bool = False,
    interested_topics: str | None = None,
) -> None:
    from_addr = os.getenv("CONFIRMATION_EMAIL_FROM_ADDRESS", "").strip()
    if not from_addr:
        logger.warning(
            "CONFIRMATION_EMAIL_FROM_ADDRESS not set; skipping booking confirmation"
        )
        return
    loc = normalize_body_locale(locale)
    bs = (booking_system or "").strip().lower()
    if bs == "intro-call-booking":
        support_email = os.getenv("SUPPORT_EMAIL", "").strip()
        wa_url_tpl = resolve_whatsapp_url_for_template()
        intro_data = intro_call_confirmation_template_merge_data(
            locale=loc,
            full_name=full_name,
            primary_session_iso=primary_session_iso,
            interested_topics=interested_topics,
            whatsapp_url=wa_url_tpl,
            support_email=support_email or "",
        )
        merged_intro = merge_transactional_shell_template_data(
            locale=loc, template_data=intro_data
        )
        loc_line_for_ics = format_booking_location_display_line(
            location_name=location_name,
            location_address=location_address,
        )
        ics_bytes = build_booking_confirmation_ics(
            title=title,
            primary_session_iso=primary_session_iso,
            primary_session_end_iso=primary_session_end_iso,
            location_line=loc_line_for_ics,
            booking_system=booking_system,
        )
        faq_u = str(merged_intro.get("faq_url") or "").strip()
        wa_u = str(merged_intro.get("whatsapp_url") or "").strip()
        subj, html_doc, plain_text = render_intro_call_confirmation_email(
            locale=loc,
            full_name=full_name,
            primary_session_iso=primary_session_iso,
            interested_topics=interested_topics,
            whatsapp_url=wa_u,
            faq_url=faq_u,
            support_email=support_email or "",
        )
        full_html = substitute_shell_placeholders(html_doc, merged_intro)
        intro_attachments: list[tuple[str, str, bytes]] | None = None
        if ics_bytes is not None:
            intro_attachments = [
                (
                    BOOKING_ICS_ATTACHMENT_FILENAME,
                    "text/calendar; charset=utf-8; method=PUBLISH",
                    ics_bytes,
                )
            ]
        try:
            send_mime_email_with_optional_attachments(
                source=from_addr,
                to_addresses=[to_email.strip().lower()],
                subject=subj,
                body_text=plain_text,
                body_html=full_html,
                inline_image_cid=None,
                png_bytes=None,
                attachments=intro_attachments,
            )
        except Exception:
            logger.exception(
                "Intro-call confirmation email failed (MIME path)",
                extra={"lead_email": mask_email(to_email)},
            )
        return

    template = f"evolvesprouts-booking-confirmation-{loc}"
    data: dict[str, Any] = booking_confirmation_template_merge_data(
        locale=loc,
        full_name=full_name,
        title=title,
        service_key=service_key,
        service_type=service_type,
        schedule_date=schedule_date,
        schedule_time=schedule_time,
        location_name=location_name,
        location_address=location_address,
        primary_session_iso=primary_session_iso,
        primary_session_end_iso=primary_session_end_iso,
        booking_system=booking_system,
        service_tier_label=service_tier_label,
        payment_method_code=payment_method,
        total_amount=total_amount,
        is_pending_payment=is_pending_payment,
        whatsapp_url=resolve_whatsapp_url_for_template(),
        consultation_writing_focus_label=consultation_writing_focus_label,
        consultation_level_label=consultation_level_label,
        session_slots=session_slots,
        location_url=location_url,
        is_free=is_free,
    )

    loc_line_for_ics = format_booking_location_display_line(
        location_name=location_name,
        location_address=location_address,
    )
    ics_bytes = build_booking_confirmation_ics(
        title=title,
        primary_session_iso=primary_session_iso,
        primary_session_end_iso=primary_session_end_iso,
        location_line=loc_line_for_ics,
        booking_system=booking_system,
    )
    if ics_bytes is not None:
        data["include_calendar_note_after_schedule_html"] = True
        data["include_calendar_note_after_schedule_plain"] = True
        data["include_calendar_fallback_hint_html"] = False
        data["include_calendar_fallback_hint_plain"] = False

    merged = merge_transactional_shell_template_data(locale=loc, template_data=data)

    pm_lower = payment_method.lower().strip()
    png_bytes: bytes | None = None
    if (
        not is_free
        and is_pending_payment
        and pm_lower == "fps_qr"
        and isinstance(fps_qr_image_data_url, str)
        and fps_qr_image_data_url.strip()
    ):
        png_bytes = decode_fps_qr_png_data_url(fps_qr_image_data_url)
        if png_bytes is None:
            logger.warning(
                "Invalid fps_qr_image_data_url for booking confirmation; "
                "falling back to template without inline QR",
                extra={"lead_email": mask_email(to_email)},
            )

    use_mime_path = png_bytes is not None or ics_bytes is not None

    if use_mime_path:
        wa_url = str(merged.get("whatsapp_url") or "").strip()
        faq_url = str(merged.get("faq_url") or "").strip()
        attach_ics = ics_bytes is not None
        subject, html_doc, plain_text = render_booking_confirmation_email(
            locale=loc,
            full_name=full_name,
            title=title,
            service_key=service_key,
            service_type=service_type,
            schedule_date=schedule_date,
            schedule_time=schedule_time,
            location_name=location_name,
            location_address=location_address,
            primary_session_iso=primary_session_iso,
            primary_session_end_iso=primary_session_end_iso,
            booking_system=booking_system,
            service_tier_label=service_tier_label,
            payment_method_code=payment_method,
            total_amount=total_amount,
            is_pending_payment=is_pending_payment,
            whatsapp_url=wa_url,
            faq_url=faq_url,
            include_fps_qr_image=png_bytes is not None,
            consultation_writing_focus_label=consultation_writing_focus_label,
            consultation_level_label=consultation_level_label,
            attach_calendar_invite_ics=attach_ics,
            session_slots=session_slots,
            location_url=location_url,
            is_free=is_free,
        )
        full_html = substitute_shell_placeholders(html_doc, merged)
        mime_attachments: list[tuple[str, str, bytes]] | None = None
        if ics_bytes is not None:
            mime_attachments = [
                (
                    BOOKING_ICS_ATTACHMENT_FILENAME,
                    "text/calendar; charset=utf-8; method=PUBLISH",
                    ics_bytes,
                )
            ]
        try:
            send_mime_email_with_optional_attachments(
                source=from_addr,
                to_addresses=[to_email.strip().lower()],
                subject=subject,
                body_text=plain_text,
                body_html=full_html,
                inline_image_cid="fps_qr" if png_bytes is not None else None,
                png_bytes=png_bytes,
                attachments=mime_attachments,
            )
        except Exception:
            logger.exception(
                "Booking confirmation email failed (MIME path)",
                extra={"lead_email": mask_email(to_email)},
            )
        return

    try:
        send_templated_email(
            source=from_addr,
            to_addresses=[to_email.strip().lower()],
            template_name=template,
            template_data=merged,
        )
    except Exception:
        logger.exception(
            "Booking confirmation email failed",
            extra={"lead_email": mask_email(to_email), "template": template},
        )
