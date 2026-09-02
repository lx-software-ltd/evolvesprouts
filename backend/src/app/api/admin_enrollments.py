"""Admin enrollment API handlers."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import (
    parse_body,
    parse_uuid,
    require_admin_identity,
    split_route_parts,
)
from app.api.discount_enrollment_scope import (
    ensure_discount_code_eligible_for_instance,
    service_id_for_instance,
)
from app.api.admin_billing_common import batch_enrollment_party_display_names
from app.api.admin_services_common import (
    encode_enrollment_cursor,
    parse_create_enrollment_payload,
    parse_enrollment_filters,
    parse_update_enrollment_payload,
    request_id,
    serialize_enrollment,
)
from app.api.instance_capacity_status import bulk_reconcile_instance_capacity_status
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import Enrollment
from app.db.models.enums import BillingBillToKind, EnrollmentStatus
from app.db.models.family import Family
from app.db.models.organization import Organization
from app.db.repositories import (
    DiscountCodeRepository,
    EnrollmentRepository,
    ServiceInstanceRepository,
)
from app.exceptions import NotFoundError, ValidationError
from app.services.billing_enrollment_confirmation import (
    promote_prospect_party_for_enrollment,
)
from app.utils import json_response, method_not_allowed, not_found
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _enrollment_visible_under_instance_anchor(
    session: Session, enrollment: Enrollment, anchor_instance_id: UUID
) -> bool:
    """True when the enrollment row belongs to ``anchor_instance_id``."""
    del session
    return enrollment.instance_id == anchor_instance_id


def handle_admin_enrollments_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
    instance_id: UUID,
) -> dict[str, Any]:
    """Handle nested enrollment routes under an instance."""
    logger.info(
        "Handling admin enrollments route",
        extra={"method": method, "path": path, "instance_id": str(instance_id)},
    )
    parts = split_route_parts(path)
    if len(parts) < 6 or parts[0] != "admin" or parts[1] != "services":
        return not_found(event)
    if parts[5] != "enrollments":
        return not_found(event)

    identity = require_admin_identity(event)

    if len(parts) == 6:
        if method == "GET":
            return _list_enrollments(event, instance_id=instance_id)
        if method == "POST":
            return _create_enrollment(
                event, instance_id=instance_id, actor_sub=identity.user_sub
            )
        return method_not_allowed(event)

    enrollment_id = parse_uuid(parts[6])
    if len(parts) == 7:
        if method == "PATCH":
            return _update_enrollment(
                event,
                instance_id=instance_id,
                enrollment_id=enrollment_id,
                actor_sub=identity.user_sub,
            )
        if method == "DELETE":
            return _delete_enrollment(
                event,
                instance_id=instance_id,
                enrollment_id=enrollment_id,
                actor_sub=identity.user_sub,
            )
        return method_not_allowed(event)

    return not_found(event)


def _list_enrollments(event: Mapping[str, Any], *, instance_id: UUID) -> dict[str, Any]:
    filters = parse_enrollment_filters(event)
    limit = filters["limit"]
    logger.info(
        "Listing enrollments",
        extra={"instance_id": str(instance_id), "limit": limit},
    )
    with Session(get_engine()) as session:
        repository = EnrollmentRepository(session)
        rows = repository.list_enrollments(
            instance_id=instance_id,
            limit=limit + 1,
            status=filters["status"],
            cursor_created_at=filters["cursor_created_at"],
            cursor_id=filters["cursor_id"],
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        next_cursor = (
            encode_enrollment_cursor(page_rows[-1]) if has_more and page_rows else None
        )
        total_count = repository.count_enrollments(
            instance_id=instance_id, status=filters["status"]
        )
        party_labels = batch_enrollment_party_display_names(session, page_rows)
        items = [
            serialize_enrollment(row, party_display_name=party_labels[idx])
            for idx, row in enumerate(page_rows)
        ]
        return json_response(
            200,
            {
                "items": items,
                "next_cursor": next_cursor,
                "total_count": total_count,
            },
            event=event,
        )


def _create_enrollment(
    event: Mapping[str, Any], *, instance_id: UUID, actor_sub: str
) -> dict[str, Any]:
    body = parse_body(event)
    payload = parse_create_enrollment_payload(body)
    logger.info(
        "Creating enrollment",
        extra={
            "instance_id": str(instance_id),
            "actor_sub": actor_sub,
            "discount_code_id": str(payload["discount_code_id"])
            if payload["discount_code_id"]
            else None,
        },
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = EnrollmentRepository(session)
        discount_code_repository = DiscountCodeRepository(session)
        discount_code_id = payload["discount_code_id"]
        if discount_code_id is not None:
            parent_service_id = service_id_for_instance(session, instance_id)
            ensure_discount_code_eligible_for_instance(
                session,
                discount_code_id=discount_code_id,
                service_id=parent_service_id,
                instance_id=instance_id,
            )
            if not discount_code_repository.validate_and_increment(discount_code_id):
                raise ValidationError(
                    "Discount code is invalid, inactive, expired, or exhausted",
                    field="discount_code_id",
                )
        enrollment = Enrollment(
            instance_id=instance_id,
            contact_id=payload["contact_id"],
            family_id=payload["family_id"],
            organization_id=payload["organization_id"],
            ticket_tier_id=payload["ticket_tier_id"],
            discount_code_id=payload["discount_code_id"],
            status=payload["status"],
            amount_paid=payload["amount_paid"],
            currency=payload["currency"],
            notes=payload["notes"],
            created_by=actor_sub,
        )
        created = repository.create_enrollment(enrollment)
        if hasattr(session, "get"):
            instance_repository = ServiceInstanceRepository(session)
            instance_row = instance_repository.get_by_id(created.instance_id)
            if instance_row is not None:
                bulk_reconcile_instance_capacity_status(session, [instance_row])
        party_labels = batch_enrollment_party_display_names(session, [created])
        session.commit()
        return json_response(
            201,
            {
                "enrollment": serialize_enrollment(
                    created, party_display_name=party_labels[0]
                )
            },
            event=event,
        )


def _update_enrollment(
    event: Mapping[str, Any],
    *,
    instance_id: UUID,
    enrollment_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    payload = parse_update_enrollment_payload(body)
    logger.info(
        "Updating enrollment",
        extra={
            "instance_id": str(instance_id),
            "enrollment_id": str(enrollment_id),
            "actor_sub": actor_sub,
        },
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = EnrollmentRepository(session)
        enrollment = repository.get_by_id(enrollment_id)
        if enrollment is None or not _enrollment_visible_under_instance_anchor(
            session, enrollment, instance_id
        ):
            raise NotFoundError("Enrollment", str(enrollment_id))

        if "promote_to_family_id" in payload or "promote_to_organization_id" in payload:
            if (
                enrollment.contact_id is None
                or enrollment.family_id is not None
                or enrollment.organization_id is not None
            ):
                raise ValidationError(
                    "Promoting to family or organization is only allowed for contact-only "
                    "enrollments",
                    field="body",
                )
            if "promote_to_family_id" in payload:
                fid = payload["promote_to_family_id"]
                fam = session.get(Family, fid)
                if fam is None:
                    raise ValidationError(
                        "Family not found", field="promote_to_family_id"
                    )
                enrollment.contact_id = None
                enrollment.family_id = fid
                enrollment.organization_id = None
                enrollment.bill_to_kind = BillingBillToKind.FAMILY
                enrollment.bill_to_family_id = fid
                enrollment.bill_to_contact_id = None
                enrollment.bill_to_organization_id = None
            else:
                oid = payload["promote_to_organization_id"]
                org = session.get(Organization, oid)
                if org is None:
                    raise ValidationError(
                        "Organization not found",
                        field="promote_to_organization_id",
                    )
                enrollment.contact_id = None
                enrollment.family_id = None
                enrollment.organization_id = oid
                enrollment.bill_to_kind = BillingBillToKind.ORGANIZATION
                enrollment.bill_to_organization_id = oid
                enrollment.bill_to_contact_id = None
                enrollment.bill_to_family_id = None

            promote_prospect_party_for_enrollment(session, enrollment)

        if "status" in payload:
            enrollment.status = payload["status"]
            if payload["status"] == EnrollmentStatus.CANCELLED:
                enrollment.cancelled_at = datetime.now(UTC)
            else:
                enrollment.cancelled_at = None
        if "enrolled_at" in payload:
            enrollment.enrolled_at = payload["enrolled_at"]
        if "amount_paid" in payload:
            enrollment.amount_paid = payload["amount_paid"]
        if "currency" in payload:
            enrollment.currency = payload["currency"]
        if "notes" in payload:
            enrollment.notes = payload["notes"]
        if "discount_code_id" in payload:
            new_id = payload["discount_code_id"]
            old_id = enrollment.discount_code_id
            if new_id != old_id:
                discount_repo = DiscountCodeRepository(session)
                parent_service_id = service_id_for_instance(session, instance_id)
                if old_id is not None:
                    if not discount_repo.decrement_uses(old_id):
                        raise ValidationError(
                            "Unable to release prior discount code usage",
                            field="discount_code_id",
                        )
                if new_id is not None:
                    ensure_discount_code_eligible_for_instance(
                        session,
                        discount_code_id=new_id,
                        service_id=parent_service_id,
                        instance_id=instance_id,
                    )
                    if not discount_repo.validate_and_increment(new_id):
                        if old_id is not None:
                            discount_repo.validate_and_increment(old_id)
                        raise ValidationError(
                            "Discount code is invalid, inactive, expired, or exhausted",
                            field="discount_code_id",
                        )
                enrollment.discount_code_id = new_id

        updated = repository.update(enrollment)
        if hasattr(session, "get"):
            instance_repository = ServiceInstanceRepository(session)
            instance_row = instance_repository.get_by_id(updated.instance_id)
            if instance_row is not None:
                bulk_reconcile_instance_capacity_status(session, [instance_row])
        party_labels = batch_enrollment_party_display_names(session, [updated])
        session.commit()
        return json_response(
            200,
            {
                "enrollment": serialize_enrollment(
                    updated, party_display_name=party_labels[0]
                )
            },
            event=event,
        )


def _delete_enrollment(
    event: Mapping[str, Any],
    *,
    instance_id: UUID,
    enrollment_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    logger.info(
        "Deleting enrollment",
        extra={
            "instance_id": str(instance_id),
            "enrollment_id": str(enrollment_id),
            "actor_sub": actor_sub,
        },
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = EnrollmentRepository(session)
        enrollment = repository.get_by_id(enrollment_id)
        if enrollment is None or not _enrollment_visible_under_instance_anchor(
            session, enrollment, instance_id
        ):
            raise NotFoundError("Enrollment", str(enrollment_id))
        discount_repo = DiscountCodeRepository(session)
        if enrollment.discount_code_id is not None:
            if not discount_repo.decrement_uses(enrollment.discount_code_id):
                raise ValidationError(
                    "Unable to release discount code usage for this enrollment",
                    field="discount_code_id",
                )
        repository.delete(enrollment)
        if hasattr(session, "get"):
            instance_repository = ServiceInstanceRepository(session)
            instance_row = instance_repository.get_by_id(enrollment.instance_id)
            if instance_row is not None:
                bulk_reconcile_instance_capacity_status(session, [instance_row])
        session.commit()
        return json_response(204, {}, event=event)
