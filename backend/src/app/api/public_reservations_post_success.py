"""Post-commit hooks for public reservation submissions."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.api.public_booking_confirmation_email import send_booking_confirmation_email
from app.api.public_form_hooks import (
    mailchimp_booking_tag_from_payload,
    maybe_subscribe_booking_marketing,
    normalize_body_locale,
)
from app.services.public_form_internal_notifications import (
    build_reservation_recap_lines,
    send_sales_form_recap_email,
)
from app.utils.fps_qr_png import optional_fps_qr_data_url_from_payload
from app.utils.logging import get_logger, mask_email

logger = get_logger(__name__)


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _session_slots_for_email(
    raw: Any,
) -> list[dict[str, str]] | None:
    if not isinstance(raw, list) or not raw:
        return None
    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        start = item.get("start_iso")
        if not isinstance(start, str) or not start.strip():
            continue
        row: dict[str, str] = {"start_iso": start.strip()}
        end = item.get("end_iso")
        if isinstance(end, str) and end.strip():
            row["end_iso"] = end.strip()
        out.append(row)
    return out or None


def _run_reservation_post_success_hooks(payload: Mapping[str, Any]) -> None:
    """Transactional email, Mailchimp, and sales recap (best-effort)."""

    email = str(payload.get("attendee_email") or "").strip()
    full_name = str(payload.get("attendee_name") or "").strip()
    locale = normalize_body_locale(payload.get("locale"))
    title = str(payload.get("title") or "").strip() or "Your booking"
    schedule_date = _optional_str(payload.get("schedule_date"))
    schedule_time = _optional_str(payload.get("schedule_time"))
    location_name = _optional_str(payload.get("location_name"))
    location_address = _optional_str(payload.get("location_address"))
    primary_session_iso = _optional_str(payload.get("primary_session_start_iso"))
    primary_session_end_iso = _optional_str(payload.get("primary_session_end_iso"))
    booking_system_for_email = _optional_str(payload.get("booking_system"))
    service_key_for_email = _optional_str(payload.get("service_key"))
    service_type_for_email = _optional_str(payload.get("service_type"))
    service_tier_label = _optional_str(payload.get("service_tier"))
    consultation_focus = _optional_str(payload.get("consultation_writing_focus_label"))
    consultation_level = _optional_str(payload.get("consultation_level_label"))
    session_slots = _session_slots_for_email(payload.get("session_slots"))
    location_url = _optional_str(payload.get("location_url"))
    payment_method = str(payload.get("payment_method") or "").strip() or "unknown"
    total_dec = payload["total_amount"]
    total_amount = f"HK${float(total_dec):,.2f}"
    stripe_pi = _optional_str(payload.get("stripe_payment_intent_id"))
    pm_lower = payment_method.lower()
    is_free = pm_lower == "free"
    is_pending = False if is_free else (pm_lower != "stripe" and not stripe_pi)
    fps_qr_data_url = optional_fps_qr_data_url_from_payload(
        payload.get("fps_qr_image_data_url")
    )

    if email and full_name:
        try:
            send_booking_confirmation_email(
                to_email=email,
                full_name=full_name,
                title=title,
                service_key=service_key_for_email,
                service_type=service_type_for_email,
                schedule_date=schedule_date,
                schedule_time=schedule_time,
                location_name=location_name,
                location_address=location_address,
                primary_session_iso=primary_session_iso,
                primary_session_end_iso=primary_session_end_iso,
                booking_system=booking_system_for_email,
                service_tier_label=service_tier_label,
                payment_method=payment_method,
                total_amount=total_amount,
                is_pending_payment=is_pending,
                locale=locale,
                fps_qr_image_data_url=fps_qr_data_url,
                consultation_writing_focus_label=consultation_focus,
                consultation_level_label=consultation_level,
                session_slots=session_slots,
                location_url=location_url,
                is_free=is_free,
                interested_topics=_optional_str(payload.get("interested_topics")),
            )
        except Exception:
            # Best-effort: confirmation email must not roll back a committed booking.
            logger.exception(
                "Unexpected error sending booking confirmation",
                extra={"lead_email": mask_email(email)},
            )

    try:
        booking_tag = mailchimp_booking_tag_from_payload(payload)
        maybe_subscribe_booking_marketing(
            marketing_opt_in=payload.get("marketing_opt_in"),
            email=email,
            full_name=full_name,
            tag_name=booking_tag,
        )
    except Exception:
        # Best-effort: marketing subscribe must not roll back a committed booking.
        logger.exception(
            "Unexpected error in booking marketing subscribe",
            extra={"lead_email": mask_email(email)},
        )

    recap_payload: dict[str, Any] = dict(payload)
    recap_payload.setdefault(
        "phone_region", str(payload.get("phone_region") or "") or None
    )
    recap_payload.setdefault(
        "phone_national_number",
        str(payload.get("phone_national_number") or "") or None,
    )

    send_sales_form_recap_email(
        form_title="Reservation",
        body_lines=build_reservation_recap_lines(payload=recap_payload),
        required=False,
        retry_transient_failures=True,
    )
