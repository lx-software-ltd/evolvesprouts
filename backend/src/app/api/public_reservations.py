"""Public reservation submission handlers."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin_request import parse_body
from app.api.discount_enrollment_scope import ensure_discount_code_eligible_for_instance
from app.api.public_form_hooks import (
    first_name_from_full_name,
    mailchimp_booking_tag_from_payload,  # noqa: F401
    maybe_subscribe_booking_marketing,  # noqa: F401
    send_booking_confirmation_email,  # noqa: F401
)
from app.api.public_reservations_intro_call import (
    _enforce_intro_call_invariants,
    _resolve_booking_identity,
    _resolve_consultation_or_intro_service,
)
from app.api.public_reservations_billing import (
    _apply_enrollment_bill_to,
    _validate_discount_code_redemption_scope,
    _validate_public_bill_to_membership,
)
from app.api.public_reservations_persistence import (
    _PUBLIC_RESERVATION_ENROLLMENT_ACTOR,
    _build_reservation_lead_metadata,
    _create_booking_instance_for_service,
    _generate_booking_instance_slug,
    _persist_session_slots_for_booking_instance,
    _prepare_consultation_booking_slots,
)
from app.api.public_reservations_post_success import _run_reservation_post_success_hooks
from app.api.public_reservations_stripe import _validate_payment_confirmation
from app.api.public_reservations_validation import (
    _PER_BOOKING_BOOKING_SYSTEMS,
    _validate_reservation_payload,
)
from app.db.audit import AuditService, set_audit_context
from app.db.engine import get_engine
from app.db.models import CustomerPayment, Enrollment, ServiceInstance
from app.db.models.enums import (
    ContactSource,
    ContactType,
    EnrollmentStatus,
    FunnelStage,
    LeadEventType,
    LeadType,
)
from app.db.models.sales_lead import SalesLead
from app.db.repositories import DiscountCodeRepository, EnrollmentRepository
from app.db.repositories.contact import ContactRepository
from app.db.repositories.sales_lead import SalesLeadRepository
from app.db.repositories.service_instance import ServiceInstanceRepository
from app.exceptions import ConflictError, ValidationError
from app.services.customer_billing import record_reservation_customer_payment
from app.services import sales_assignment
from app.services.intro_call_slots import is_intro_call_slot_available  # noqa: F401
from app.services.public_form_internal_notifications import (
    build_reservation_recap_lines,  # noqa: F401
    send_sales_form_recap_email,  # noqa: F401
)
from app.services.turnstile import (
    extract_client_ip,
    extract_turnstile_token,
    verify_turnstile_token,
)
from app.utils import json_response
from app.utils.logging import get_logger, mask_email, mask_pii

logger = get_logger(__name__)


def _handle_public_reservation(
    event: Mapping[str, Any],
    method: str,
) -> dict[str, Any]:
    """Handle public reservation submissions."""
    if method != "POST":
        return json_response(405, {"error": "Method not allowed"}, event=event)

    turnstile_token = extract_turnstile_token(event)
    if not turnstile_token:
        return json_response(
            400,
            {"error": "Missing X-Turnstile-Token header"},
            event=event,
        )

    remote_ip = extract_client_ip(event)
    is_turnstile_valid = verify_turnstile_token(turnstile_token, remote_ip=remote_ip)
    if not is_turnstile_valid:
        return json_response(
            403,
            {"error": "Captcha verification failed"},
            event=event,
        )

    try:
        body = parse_body(event)
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    try:
        reservation_payload = _validate_reservation_payload(body)
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    try:
        _validate_payment_confirmation(event, reservation_payload)
    except ValidationError as exc:
        return json_response(
            exc.status_code,
            exc.to_dict(),
            event=event,
        )

    try:
        request_id_str = str(event.get("requestContext", {}).get("requestId") or "")
        created_enrollment_id: UUID | None = None
        stripe_pi_idempotent_hit: bool = False
        stripe_pi_existing_payment_id: UUID | None = None
        with Session(get_engine()) as session:
            with session.begin():
                set_audit_context(
                    session,
                    user_id=None,
                    request_id=request_id_str or None,
                )
                booking_system = reservation_payload.get("booking_system")
                per_booking = booking_system in _PER_BOOKING_BOOKING_SYSTEMS
                scheduled_instance: ServiceInstance | None = None
                if per_booking:
                    raw_slug_ignored = reservation_payload.get("service_instance_slug")
                    if raw_slug_ignored not in (None, ""):
                        logger.debug(
                            "Ignoring serviceInstanceSlug for per-booking reservation",
                            extra={
                                "booking_system": booking_system,
                                "service_instance_slug": str(raw_slug_ignored).strip(),
                            },
                        )
                    catalog_service = _resolve_consultation_or_intro_service(
                        session, reservation_payload
                    )
                else:
                    scheduled_instance = _resolve_booking_identity(
                        session, reservation_payload
                    )
                    catalog_service = scheduled_instance.service

                reservation_payload = {
                    **reservation_payload,
                    "service_type": catalog_service.service_type.value,
                }
                now_utc = datetime.now(tz=UTC)
                intro_slot_bounds: tuple[datetime, datetime] | None = None
                consultation_slot_rows: list[tuple[datetime, datetime, int]] | None = (
                    None
                )
                if booking_system == "intro-call-booking":
                    intro_slot_bounds = _enforce_intro_call_invariants(
                        session,
                        reservation_payload,
                        catalog_service,
                        now=now_utc,
                    )
                elif booking_system == "consultation-booking":
                    consultation_slot_rows = _prepare_consultation_booking_slots(
                        session, reservation_payload
                    )
                _validate_discount_code_redemption_scope(
                    session,
                    reservation_payload,
                    resolved_service=catalog_service,
                    resolved_instance=scheduled_instance,
                )

                stripe_pi = str(
                    reservation_payload.get("stripe_payment_intent_id") or ""
                ).strip()
                skip_persistence = False
                if per_booking and stripe_pi:
                    existing_pi_payment = session.execute(
                        select(CustomerPayment).where(
                            CustomerPayment.stripe_payment_intent_id == stripe_pi
                        )
                    ).scalar_one_or_none()
                    if existing_pi_payment is not None:
                        stripe_pi_idempotent_hit = True
                        stripe_pi_existing_payment_id = existing_pi_payment.id
                        skip_persistence = True

                instance_id_for_audit: UUID = (
                    scheduled_instance.id
                    if scheduled_instance is not None
                    else catalog_service.id
                )
                booking_instance_slug_for_lead: str | None = None
                dc_row = None
                dc_text = reservation_payload.get("discount_code")

                if not skip_persistence:
                    contact_repo = ContactRepository(session)
                    lead_repo = SalesLeadRepository(session)
                    src_detail = "public-www-booking"
                    ma_obj = reservation_payload.get("marketing_attribution")
                    if booking_system == "intro-call-booking":
                        if isinstance(ma_obj, dict) and ma_obj:
                            src_detail = json.dumps(
                                {"source": "public-www-booking", **ma_obj},
                                separators=(",", ":"),
                            )
                        else:
                            src_detail = json.dumps(
                                {"source": "public-www-booking"}, separators=(",", ":")
                            )
                    contact, _created = contact_repo.upsert_by_email(
                        reservation_payload["attendee_email"],
                        first_name=first_name_from_full_name(
                            reservation_payload["attendee_name"]
                        ),
                        source=ContactSource.RESERVATION,
                        source_detail=src_detail,
                        contact_type=ContactType.PARENT,
                    )
                    new_region = reservation_payload["phone_region"]
                    new_national = reservation_payload["phone_national_number"]
                    if (
                        new_region is not None
                        and new_national is not None
                        and (
                            contact.phone_region is None
                            or contact.phone_national_number is None
                        )
                    ):
                        contact.phone_region = new_region
                        contact.phone_national_number = new_national
                    contact_repo.update(contact)

                    _validate_public_bill_to_membership(
                        session,
                        {
                            "bill_to_kind": reservation_payload["bill_to_kind"],
                            "bill_to_family_id": reservation_payload[
                                "bill_to_family_id"
                            ],
                            "bill_to_organization_id": reservation_payload[
                                "bill_to_organization_id"
                            ],
                        },
                        contact_id=contact.id,
                    )

                    if dc_text:
                        dc_lookup = DiscountCodeRepository(session)
                        dc_row = dc_lookup.get_by_code(str(dc_text))

                    instance_repo = ServiceInstanceRepository(session)
                    enrollment_repo = EnrollmentRepository(session)
                    discount_repo = DiscountCodeRepository(session)

                    if per_booking:
                        booking_row = _create_booking_instance_for_service(
                            session,
                            instance_repo,
                            catalog_service,
                            reservation_payload,
                            now_utc=now_utc,
                        )
                        target_instance_id = booking_row.id
                        instance_id_for_audit = booking_row.id
                        booking_instance_slug_for_lead = booking_row.slug
                    else:
                        if scheduled_instance is None:
                            raise ValidationError(
                                "service instance could not be resolved",
                                field="serviceInstanceSlug",
                            )
                        target_instance_id = scheduled_instance.id

                    has_enrollment = (
                        enrollment_repo.contact_has_enrollment_for_instance(
                            instance_id=target_instance_id,
                            contact_id=contact.id,
                        )
                    )
                    is_intro_booking = booking_system == "intro-call-booking"

                    if not has_enrollment:
                        instance_service_id = catalog_service.id
                        if dc_row is not None:
                            ensure_discount_code_eligible_for_instance(
                                session,
                                discount_code_id=dc_row.id,
                                service_id=instance_service_id,
                                instance_id=target_instance_id,
                            )
                        enrollment_row = Enrollment(
                            instance_id=target_instance_id,
                            contact_id=contact.id,
                            family_id=None,
                            organization_id=None,
                            ticket_tier_id=None,
                            discount_code_id=None,
                            status=EnrollmentStatus.REGISTERED,
                            amount_paid=reservation_payload["total_amount"],
                            currency=reservation_payload["currency"],
                            notes=None,
                            created_by=_PUBLIC_RESERVATION_ENROLLMENT_ACTOR,
                        )
                        _apply_enrollment_bill_to(
                            enrollment_row,
                            contact_id=contact.id,
                            bill={
                                "bill_to_kind": reservation_payload["bill_to_kind"],
                                "bill_to_contact_id": reservation_payload[
                                    "bill_to_contact_id"
                                ],
                                "bill_to_family_id": reservation_payload[
                                    "bill_to_family_id"
                                ],
                                "bill_to_organization_id": reservation_payload[
                                    "bill_to_organization_id"
                                ],
                            },
                        )
                        created_enrollment, create_err = (
                            enrollment_repo.try_create_enrollment_with_capacity_guard(
                                enrollment_row
                            )
                        )
                        if create_err == "capacity_full":
                            raise ValidationError(
                                "This cohort is full and is not accepting a waitlist for "
                                "public bookings. Your payment was processed; contact support "
                                "if you need a refund.",
                                field="serviceInstanceSlug",
                                status_code=409,
                            )
                        if create_err != "duplicate" and created_enrollment is not None:
                            created_enrollment_id = created_enrollment.id
                            if dc_row is not None:
                                if not discount_repo.validate_and_increment(dc_row.id):
                                    session.delete(created_enrollment)
                                    session.flush()
                                    raise ValidationError(
                                        "Discount code is invalid, inactive, expired, or exhausted",
                                        field="discountCode",
                                    )
                                created_enrollment.discount_code_id = dc_row.id
                                session.flush()
                            if is_intro_booking and intro_slot_bounds is not None:
                                s0, s1 = intro_slot_bounds
                                _persist_session_slots_for_booking_instance(
                                    session,
                                    booking_instance_id=target_instance_id,
                                    purpose_service_id=catalog_service.id,
                                    slots=[(s0, s1, 0)],
                                    reservation_payload=reservation_payload,
                                    now_utc=now_utc,
                                    is_intro_booking=True,
                                )
                            elif (
                                booking_system == "consultation-booking"
                                and consultation_slot_rows is not None
                            ):
                                _persist_session_slots_for_booking_instance(
                                    session,
                                    booking_instance_id=target_instance_id,
                                    purpose_service_id=catalog_service.id,
                                    slots=consultation_slot_rows,
                                    reservation_payload=reservation_payload,
                                    now_utc=now_utc,
                                    is_intro_booking=False,
                                )
                            _pay, _, _dup_pi = record_reservation_customer_payment(
                                session,
                                enrollment_id=created_enrollment.id,
                                contact_id=contact.id,
                                currency=reservation_payload["currency"],
                                total_amount=reservation_payload["total_amount"],
                                payment_method=reservation_payload["payment_method"],
                                stripe_payment_intent_id=reservation_payload.get(
                                    "stripe_payment_intent_id"
                                ),
                                stripe_currency=reservation_payload.get(
                                    "stripe_currency"
                                ),
                            )
                            if _dup_pi and _pay is not None:
                                stripe_pi_idempotent_hit = True
                                stripe_pi_existing_payment_id = _pay.id

                    assigned_to = sales_assignment.resolve_create_assignee(session)
                    lead = SalesLead(
                        contact_id=contact.id,
                        lead_type=LeadType.PROGRAM_ENROLLMENT,
                        funnel_stage=FunnelStage.NEW,
                        assigned_to=assigned_to,
                    )
                    lead_repo.create_with_event(
                        lead,
                        LeadEventType.CREATED,
                        metadata=_build_reservation_lead_metadata(
                            reservation_payload,
                            booking_instance_slug_for_lead=booking_instance_slug_for_lead,
                            dc_text=dc_text,
                            dc_row=dc_row,
                        ),
                    )
                    sales_assignment.record_new_lead_assignment_event(
                        lead_repo,
                        lead_id=getattr(lead, "id", None),
                        assigned_to=assigned_to,
                        actor_sub=None,
                    )
                    sales_assignment.notify_lead_assignee(session, lead, previous=None)
                    if created_enrollment_id is not None:
                        audit = AuditService(
                            session,
                            user_id=None,
                            request_id=request_id_str or None,
                        )
                        audit.log_custom(
                            table_name="enrollments",
                            record_id=created_enrollment_id,
                            action="PUBLIC_RESERVATION_PERSISTED",
                            new_values={
                                "instance_id": str(instance_id_for_audit),
                                "contact_id": str(contact.id),
                            },
                        )
    except ConflictError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)
    except Exception:
        # Persistence failures must not leak internals; return a safe 500.
        logger.exception("Reservation Aurora persistence failed")
        return json_response(
            500,
            {"error": "Unable to save reservation. Please try again."},
            event=event,
        )

    try:
        _run_reservation_post_success_hooks(reservation_payload)
    except Exception:
        # Best-effort: post-commit hooks must not change the accepted reservation response.
        logger.exception("Reservation post-success hooks failed after commit")

    logger.info(
        "Public reservation accepted",
        extra={
            "attendee_email": mask_email(reservation_payload["attendee_email"]),
            "attendee_phone": mask_pii(reservation_payload["attendee_phone"]),
            "title": reservation_payload["title"],
        },
    )

    if stripe_pi_idempotent_hit and stripe_pi_existing_payment_id is not None:
        return json_response(
            200,
            {
                "message": "Reservation submitted",
                "duplicateStripePaymentIntent": True,
                "customerPaymentId": str(stripe_pi_existing_payment_id),
            },
            event=event,
        )

    return json_response(
        202,
        {"message": "Reservation submitted"},
        event=event,
    )


__all__ = [
    "_create_booking_instance_for_service",
    "_enforce_intro_call_invariants",
    "_generate_booking_instance_slug",
    "_handle_public_reservation",
    "_run_reservation_post_success_hooks",
    "_validate_discount_code_redemption_scope",
    "_validate_payment_confirmation",
    "_validate_reservation_payload",
]
