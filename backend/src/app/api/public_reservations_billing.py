"""Bill-to checks and the website charge that follows a new enrollment."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.public_discount_validate import (
    _is_usable_now as discount_code_is_usable_now,
)
from app.db.models import Enrollment, Service, ServiceInstance
from app.db.models.enums import BillingBillToKind, DiscountType
from app.db.models.family import FamilyMember
from app.db.models.organization import OrganizationMember
from app.exceptions import ValidationError


def _apply_enrollment_bill_to(
    enrollment: Enrollment,
    *,
    contact_id: UUID,
    bill: Mapping[str, Any],
) -> None:
    kind: BillingBillToKind = bill["bill_to_kind"]
    enrollment.bill_to_kind = kind
    if kind == BillingBillToKind.CONTACT:
        enrollment.bill_to_contact_id = bill.get("bill_to_contact_id") or contact_id
        enrollment.bill_to_family_id = None
        enrollment.bill_to_organization_id = None
    elif kind == BillingBillToKind.FAMILY:
        fid = bill.get("bill_to_family_id")
        if fid is None:
            raise ValidationError(
                "billToFamilyId is required when billToKind is family",
                field="billToFamilyId",
            )
        enrollment.bill_to_family_id = fid
        enrollment.bill_to_contact_id = None
        enrollment.bill_to_organization_id = None
    else:
        oid = bill.get("bill_to_organization_id")
        if oid is None:
            raise ValidationError(
                "billToOrganizationId is required when billToKind is organization",
                field="billToOrganizationId",
            )
        enrollment.bill_to_organization_id = oid
        enrollment.bill_to_contact_id = None
        enrollment.bill_to_family_id = None


def _validate_public_bill_to_membership(
    session: Session, bill: Mapping[str, Any], *, contact_id: UUID
) -> None:
    """Ensure bill-to family/org exists and the contact is a member."""
    kind = bill["bill_to_kind"]
    if kind == BillingBillToKind.FAMILY:
        fid = bill.get("bill_to_family_id")
        if fid is None:
            return
        fam_row = session.execute(
            select(FamilyMember.id).where(
                FamilyMember.family_id == fid,
                FamilyMember.contact_id == contact_id,
            )
        ).first()
        if fam_row is None:
            raise ValidationError(
                "Contact is not a member of this family",
                field="billToFamilyId",
            )
    elif kind == BillingBillToKind.ORGANIZATION:
        oid = bill.get("bill_to_organization_id")
        if oid is None:
            return
        org_row = session.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.organization_id == oid,
                OrganizationMember.contact_id == contact_id,
            )
        ).first()
        if org_row is None:
            raise ValidationError(
                "Contact is not a member of this organization",
                field="billToOrganizationId",
            )


def _validate_discount_code_redemption_scope(
    session: Session,
    payload: Mapping[str, Any],
    *,
    resolved_service: Service,
    resolved_instance: ServiceInstance | None,
) -> None:
    """Ensure discount code scope matches the reservation context."""
    from app.api import public_reservations as pr

    code = payload.get("discount_code")
    if not code:
        return

    repository = pr.DiscountCodeRepository(session)
    row = repository.get_by_code(str(code))
    if row is None or not discount_code_is_usable_now(row):
        raise ValidationError("Invalid discount code", field="discountCode")

    if row.discount_type == DiscountType.REFERRAL:
        raise ValidationError("Invalid discount code", field="discountCode")

    if row.instance_id is not None:
        if resolved_instance is None:
            raise ValidationError(
                "Discount code is not valid for this booking",
                field="discountCode",
            )
        if row.instance_id != resolved_instance.id:
            raise ValidationError(
                "Discount code is not valid for this booking",
                field="discountCode",
            )
        return

    if row.service_id is None:
        return

    if row.service_id != resolved_service.id:
        raise ValidationError(
            "Discount code is not valid for this booking",
            field="discountCode",
        )


def record_public_enrollment_billing(
    session: Session,
    *,
    enrollment: Enrollment,
    contact: Any,
    reservation_payload: Mapping[str, Any],
    lead_metadata: Mapping[str, Any],
) -> tuple[Any, bool, UUID | None, Any]:
    """Create the lead, the payment, then the invoice. Lead comes first so a paid booking converts it."""
    from app.api.public_reservations_persistence import (
        _PUBLIC_RESERVATION_ENROLLMENT_ACTOR,
    )
    from app.db.models.enums import LeadEventType, LeadType
    from app.services.customer_billing import record_reservation_customer_payment
    from app.services.enrollment_billing import attach_public_invoice
    from app.services.lead_funnel_automation import ensure_contact_lead

    ensure_contact_lead(
        session,
        contact_id=contact.id,
        contact=contact,
        lead_type=LeadType.PROGRAM_ENROLLMENT,
        metadata=lead_metadata,
        attach_event_type=LeadEventType.ACTION_RECORDED,
    )
    pay, _, duplicate = record_reservation_customer_payment(
        session,
        enrollment_id=enrollment.id,
        contact_id=contact.id,
        currency=reservation_payload["currency"],
        total_amount=reservation_payload["total_amount"],
        payment_method=reservation_payload["payment_method"],
        stripe_payment_intent_id=reservation_payload.get("stripe_payment_intent_id"),
        stripe_currency=reservation_payload.get("stripe_currency"),
    )
    if pay is None:
        return None, False, None, None
    followup = attach_public_invoice(
        session,
        enrollment,
        pay,
        actor=_PUBLIC_RESERVATION_ENROLLMENT_ACTOR,
        attendee_name=str(reservation_payload.get("attendee_name") or ""),
        attendee_email=str(reservation_payload.get("attendee_email") or ""),
        duplicate=bool(duplicate),
    )
    return pay, bool(duplicate), pay.id, followup


def heal_duplicate_public_invoice(
    session: Session,
    payment: Any,
    *,
    attendee_name: str,
    attendee_email: str,
) -> Any:
    """A retried Stripe charge invoices the existing enrollment when it still has none."""
    from app.api.public_reservations_persistence import (
        _PUBLIC_RESERVATION_ENROLLMENT_ACTOR,
    )
    from app.services.enrollment_billing import attach_public_invoice

    enrollment_id = getattr(payment, "enrollment_id", None)
    if enrollment_id is None:
        return None
    enrollment = session.get(Enrollment, enrollment_id)
    if enrollment is None:
        return None
    return attach_public_invoice(
        session,
        enrollment,
        payment,
        actor=_PUBLIC_RESERVATION_ENROLLMENT_ACTOR,
        attendee_name=attendee_name,
        attendee_email=attendee_email,
        duplicate=True,
    )
