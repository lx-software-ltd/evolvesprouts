"""Admin service-instance API handlers."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin_enrollments import handle_admin_enrollments_request
from app.api.admin_request import (
    parse_body,
    parse_uuid,
    require_admin_identity,
    split_route_parts,
)
from app.api.admin_service_instance_partners import (
    reconcile_instance_partner_organizations,
    validate_partner_organization_ids,
)
from app.api.admin_entities_helpers import replace_service_instance_tags
from app.api.admin_services_common import (
    encode_instance_cursor,
    parse_create_instance_payload,
    parse_instance_filters,
    parse_update_instance_payload,
    request_id,
    serialize_instance,
)
from app.api.instance_capacity_status import bulk_reconcile_instance_capacity_status
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import (
    EventCategory,
    EventTicketTier,
    InstanceSessionSlot,
    InstanceStatus,
    Service,
    ServiceInstance,
    ServiceType,
    TrainingFormat,
    TrainingInstanceDetails,
)
from app.db.repositories import (
    EnrollmentRepository,
    ServiceInstanceRepository,
    ServiceRepository,
)
from app.exceptions import NotFoundError, ValidationError
from app.services.eventbrite_events import enqueue_eventbrite_instance_sync_by_id
from app.utils import json_response, method_not_allowed, not_found
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _capacity_commit_and_counts(
    session: Any,
    repository: ServiceInstanceRepository,
    instance_ids: list[UUID],
) -> dict[UUID, int]:
    """Commit after capacity reconcile and load counts; no-op for unit-test fake sessions."""
    if not hasattr(session, "execute"):
        return {}
    if hasattr(session, "commit"):
        session.commit()
    if hasattr(repository, "get_enrollment_counts_for_instances"):
        return repository.get_enrollment_counts_for_instances(instance_ids)
    return {}


def _is_service_instance_slug_unique_violation(exc: IntegrityError) -> bool:
    orig = getattr(exc.orig, "__cause__", None) or exc.orig
    diag = getattr(orig, "diag", None)
    constraint = getattr(diag, "constraint_name", None) if diag else None
    if constraint == "svc_instances_slug_uq":
        return True
    lowered = str(exc).lower()
    return "svc_instances_slug_uq" in lowered


def _event_category_name(service: Service) -> str:
    if service.event_details is not None:
        return service.event_details.event_category.value
    return EventCategory.WORKSHOP.value


def _resolve_event_ticket_tiers_for_persist(
    service: Service, parsed_tiers: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Fill missing tier currency from service event defaults; default name from category.

    Missing ``price`` uses the service-level ``default_price`` when set; otherwise
    callers must supply an explicit price (no silent zero).
    """
    if not parsed_tiers:
        parsed_tiers = [{}]
    event_details = service.event_details
    default_price = event_details.default_price if event_details is not None else None
    default_currency = (
        event_details.default_currency if event_details is not None else "HKD"
    )
    category_name = _event_category_name(service)
    resolved: list[dict[str, Any]] = []
    for idx, tier in enumerate(parsed_tiers):
        price = tier.get("price")
        if price is None:
            if default_price is not None:
                price = default_price
            else:
                raise ValidationError(
                    "Each event_ticket_tiers entry must include price, or the service "
                    "must define event_details.default_price",
                    field="event_ticket_tiers",
                )
        currency = tier.get("currency") or default_currency
        name = tier.get("name") or category_name
        resolved.append(
            {
                "name": name,
                "description": tier.get("description"),
                "price": price,
                "currency": currency,
                "max_quantity": tier.get("max_quantity"),
                "sort_order": tier.get("sort_order")
                if tier.get("sort_order") is not None
                else idx,
            }
        )
    return resolved


def _merge_event_ticket_tiers_with_existing(
    service: Service,
    instance: ServiceInstance | None,
    resolved_tiers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Preserve multi-tier rows and non-category tier metadata when the UI sends one tier.

    When the instance already has ticket tiers and the client sends a single tier
    object (admin Row D), merge price/currency into the tier whose ``name`` matches
    the service event category, or the sole tier, and keep other tiers unchanged.
    When the client sends N tiers for an instance with N tiers, zip-merge by
    ``sort_order`` and preserve each existing tier's name, description, max_quantity,
    and sort_order while applying payload price/currency per row.
    """
    if instance is None or not instance.ticket_tiers:
        return resolved_tiers
    existing = sorted(
        instance.ticket_tiers,
        key=lambda row: (row.sort_order, str(getattr(row, "id", ""))),
    )
    category_name = _event_category_name(service)

    if len(resolved_tiers) == 1:
        patch = resolved_tiers[0]
        if len(existing) == 1:
            t = existing[0]
            return [
                {
                    **patch,
                    "name": t.name,
                    "description": t.description,
                    "max_quantity": t.max_quantity,
                    "sort_order": t.sort_order,
                }
            ]
        match_index = next(
            (i for i, t in enumerate(existing) if t.name == category_name), None
        )
        if match_index is None:
            raise ValidationError(
                "This instance has multiple ticket tiers; none matches the service "
                f"event category ({category_name!r}). Send a full event_ticket_tiers "
                "array with one entry per tier to update prices.",
                field="event_ticket_tiers",
            )
        merged: list[dict[str, Any]] = []
        for t in existing:
            if t.name == category_name:
                merged.append(
                    {
                        **patch,
                        "name": t.name,
                        "description": t.description,
                        "max_quantity": t.max_quantity,
                        "sort_order": t.sort_order,
                    }
                )
            else:
                merged.append(
                    {
                        "name": t.name,
                        "description": t.description,
                        "price": t.price,
                        "currency": t.currency,
                        "max_quantity": t.max_quantity,
                        "sort_order": t.sort_order,
                    }
                )
        return merged

    if len(resolved_tiers) != len(existing):
        raise ValidationError(
            "event_ticket_tiers length must match the number of existing tiers "
            f"({len(existing)}); send {len(existing)} tier objects or a single tier "
            "for category-scoped price updates.",
            field="event_ticket_tiers",
        )
    res_sorted = sorted(
        resolved_tiers,
        key=lambda row: row.get("sort_order", 0),
    )
    out: list[dict[str, Any]] = []
    for t, p in zip(existing, res_sorted, strict=True):
        out.append(
            {
                "name": t.name,
                "description": t.description,
                "price": p["price"],
                "currency": p.get("currency") or t.currency,
                "max_quantity": t.max_quantity,
                "sort_order": t.sort_order,
            }
        )
    return out


def handle_admin_service_instances_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
    service_id: UUID,
) -> dict[str, Any]:
    """Handle nested service-instance routes."""
    logger.info(
        "Handling admin service-instances route",
        extra={"method": method, "path": path, "service_id": str(service_id)},
    )
    parts = split_route_parts(path)
    if len(parts) < 4 or parts[0] != "admin" or parts[1] != "services":
        return not_found(event)
    if parts[3] != "instances":
        return not_found(event)

    identity = require_admin_identity(event)

    if len(parts) == 4:
        if method == "GET":
            return _list_instances(event, service_id=service_id)
        if method == "POST":
            return _create_instance(
                event, service_id=service_id, actor_sub=identity.user_sub
            )
        return method_not_allowed(event)

    instance_id = parse_uuid(parts[4])
    if len(parts) == 5:
        if method == "GET":
            return _get_instance(event, service_id=service_id, instance_id=instance_id)
        if method == "PUT":
            return _update_instance(
                event,
                service_id=service_id,
                instance_id=instance_id,
                actor_sub=identity.user_sub,
            )
        if method == "DELETE":
            return _delete_instance(
                event,
                service_id=service_id,
                instance_id=instance_id,
                actor_sub=identity.user_sub,
            )
        return method_not_allowed(event)

    if len(parts) >= 6 and parts[5] == "enrollments":
        return handle_admin_enrollments_request(event, method, path, instance_id)

    return not_found(event)


def _list_instances(event: Mapping[str, Any], *, service_id: UUID) -> dict[str, Any]:
    filters = parse_instance_filters(event)
    limit = filters["limit"]
    logger.info(
        "Listing service instances",
        extra={"service_id": str(service_id), "limit": limit},
    )
    with Session(get_engine()) as session:
        service_repository = ServiceRepository(session)
        service = service_repository.get_by_id(service_id)
        if service is None:
            raise NotFoundError("Service", str(service_id))

        repository = ServiceInstanceRepository(session)
        rows = repository.list_instances(
            service_id=service_id,
            limit=limit + 1,
            status=filters["status"],
            cursor_created_at=filters["cursor_created_at"],
            cursor_id=filters["cursor_id"],
        )
        total_count = repository.count_instances(
            service_id=service_id,
            status=filters["status"],
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        next_cursor = (
            encode_instance_cursor(page_rows[-1]) if has_more and page_rows else None
        )
        bulk_reconcile_instance_capacity_status(session, page_rows)
        enrollment_counts = _capacity_commit_and_counts(
            session, repository, [row.id for row in page_rows]
        )
        return json_response(
            200,
            {
                "items": [
                    serialize_instance(
                        row, enrollment_counts_by_instance_id=enrollment_counts
                    )
                    for row in page_rows
                ],
                "next_cursor": next_cursor,
                "total_count": total_count,
            },
            event=event,
        )


def _create_instance(
    event: Mapping[str, Any],
    *,
    service_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    logger.info(
        "Creating service instance",
        extra={"service_id": str(service_id), "actor_sub": actor_sub},
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        service_repository = ServiceRepository(session)
        instance_repository = ServiceInstanceRepository(session)

        service = service_repository.get_by_id_with_details(service_id)
        if service is None:
            raise NotFoundError("Service", str(service_id))
        payload = parse_create_instance_payload(body, service)
        validate_partner_organization_ids(session, payload["partner_organization_ids"])

        instance = ServiceInstance(
            service_id=service_id,
            title=payload["title"],
            slug=payload["slug"],
            description=payload["description"],
            cover_image_s3_key=payload["cover_image_s3_key"],
            status=payload["status"],
            delivery_mode=payload["delivery_mode"],
            location_id=payload["location_id"],
            max_capacity=payload["max_capacity"],
            capacity_left_override=payload["capacity_left_override"],
            waitlist_enabled=payload["waitlist_enabled"],
            instructor_id=payload["instructor_id"],
            cohort=payload["cohort"],
            notes=payload["notes"],
            external_url=payload["external_url"],
            created_by=actor_sub,
        )
        type_details_raw = payload["type_details"]
        if service.service_type == ServiceType.EVENT:
            resolved = _resolve_event_ticket_tiers_for_persist(
                service, type_details_raw["event_ticket_tiers"]
            )
            type_details_raw = {
                **type_details_raw,
                "event_ticket_tiers": _merge_event_ticket_tiers_with_existing(
                    service, instance, resolved
                ),
            }
        type_details = _build_instance_type_details(
            service.service_type, type_details_raw
        )
        slots = [
            InstanceSessionSlot(
                location_id=item["location_id"],
                starts_at=item["starts_at"],
                ends_at=item["ends_at"],
                sort_order=item["sort_order"],
            )
            for item in payload["session_slots"]
        ]
        try:
            created = instance_repository.create_instance(instance, type_details, slots)
            reconcile_instance_partner_organizations(
                session,
                instance_id=created.id,
                ordered_org_ids=payload["partner_organization_ids"],
            )
            replace_service_instance_tags(
                session,
                instance_id=created.id,
                tag_ids=payload["tag_ids"],
            )
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            if _is_service_instance_slug_unique_violation(exc):
                raise ValidationError(
                    "Another instance already uses this slug. Choose a different slug.",
                    field="slug",
                    status_code=409,
                ) from exc
            raise
        if service.service_type == ServiceType.EVENT:
            enqueue_eventbrite_instance_sync_by_id(created.id)
        with_details = instance_repository.get_by_id_with_details(created.id)
        if with_details is None:
            raise NotFoundError("ServiceInstance", str(created.id))
        bulk_reconcile_instance_capacity_status(session, [with_details])
        enrollment_counts = _capacity_commit_and_counts(
            session, instance_repository, [with_details.id]
        )
        return json_response(
            201,
            {
                "instance": serialize_instance(
                    with_details,
                    enrollment_counts_by_instance_id=enrollment_counts,
                )
            },
            event=event,
        )


def _get_instance(
    event: Mapping[str, Any],
    *,
    service_id: UUID,
    instance_id: UUID,
) -> dict[str, Any]:
    logger.info(
        "Getting service instance",
        extra={"service_id": str(service_id), "instance_id": str(instance_id)},
    )
    with Session(get_engine()) as session:
        repository = ServiceInstanceRepository(session)
        instance = repository.get_by_id_with_details(instance_id)
        if instance is None or instance.service_id != service_id:
            raise NotFoundError("ServiceInstance", str(instance_id))
        bulk_reconcile_instance_capacity_status(session, [instance])
        enrollment_counts = _capacity_commit_and_counts(
            session, repository, [instance.id]
        )
        return json_response(
            200,
            {
                "instance": serialize_instance(
                    instance, enrollment_counts_by_instance_id=enrollment_counts
                )
            },
            event=event,
        )


def _update_instance(
    event: Mapping[str, Any],
    *,
    service_id: UUID,
    instance_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    logger.info(
        "Updating service instance",
        extra={
            "service_id": str(service_id),
            "instance_id": str(instance_id),
            "actor_sub": actor_sub,
        },
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        service_repository = ServiceRepository(session)
        instance_repository = ServiceInstanceRepository(session)

        service = service_repository.get_by_id_with_details(service_id)
        if service is None:
            raise NotFoundError("Service", str(service_id))
        instance = instance_repository.get_by_id_with_details(instance_id)
        if instance is None or instance.service_id != service_id:
            raise NotFoundError("ServiceInstance", str(instance_id))
        payload = parse_update_instance_payload(body, service)
        if "partner_organization_ids" in payload:
            validate_partner_organization_ids(
                session, payload["partner_organization_ids"]
            )

        if "title" in payload:
            instance.title = payload["title"]
        if "slug" in payload:
            instance.slug = payload["slug"]
        if "description" in payload:
            instance.description = payload["description"]
        if "cover_image_s3_key" in payload:
            instance.cover_image_s3_key = payload["cover_image_s3_key"]
        if "status" in payload:
            instance.status = payload["status"]
            if payload["status"] == InstanceStatus.COMPLETED:
                EnrollmentRepository(
                    session
                ).mark_registered_or_confirmed_enrollments_completed(instance.id)
        if "delivery_mode" in payload:
            instance.delivery_mode = payload["delivery_mode"]
        if "location_id" in payload:
            instance.location_id = payload["location_id"]
        if "max_capacity" in payload:
            instance.max_capacity = payload["max_capacity"]
        if "capacity_left_override" in payload:
            instance.capacity_left_override = payload["capacity_left_override"]
        if "waitlist_enabled" in payload:
            instance.waitlist_enabled = payload["waitlist_enabled"]
        if "instructor_id" in payload:
            instance.instructor_id = payload["instructor_id"]
        if "cohort" in payload:
            instance.cohort = payload["cohort"]
        if "notes" in payload:
            instance.notes = payload["notes"]
        if "external_url" in payload:
            instance.external_url = payload["external_url"]
        if "session_slots" in payload:
            instance.session_slots.clear()
            for item in payload["session_slots"]:
                instance.session_slots.append(
                    InstanceSessionSlot(
                        location_id=item["location_id"],
                        starts_at=item["starts_at"],
                        ends_at=item["ends_at"],
                        sort_order=item["sort_order"],
                    )
                )
        if "type_details" in payload:
            type_details_raw = payload["type_details"]
            if service.service_type == ServiceType.EVENT:
                type_details_raw = {
                    **type_details_raw,
                    "event_ticket_tiers": _resolve_event_ticket_tiers_for_persist(
                        service, type_details_raw["event_ticket_tiers"]
                    ),
                }
            _apply_instance_type_details(
                instance=instance,
                service_type=service.service_type,
                parsed_details=type_details_raw,
            )
        if "partner_organization_ids" in payload:
            # Partner M2M rows are reconciled with bulk DELETE + INSERT (see
            # reconcile_instance_partner_organizations), not via the ORM collection,
            # because selectinload-loaded link objects would stay in deleted state in
            # the session while instance.partner_organization_links still references
            # them — session.add(instance) would then cascade and raise
            # InvalidRequestError. Session-tracked instance + commit() persists
            # scalar changes without re-adding the instance.
            reconcile_instance_partner_organizations(
                session,
                instance_id=instance.id,
                ordered_org_ids=payload["partner_organization_ids"],
            )
        if "tag_ids" in payload:
            replace_service_instance_tags(
                session,
                instance_id=instance.id,
                tag_ids=payload["tag_ids"],
            )

        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            if _is_service_instance_slug_unique_violation(exc):
                raise ValidationError(
                    "Another instance already uses this slug. Choose a different slug.",
                    field="slug",
                    status_code=409,
                ) from exc
            raise
        if service.service_type == ServiceType.EVENT:
            enqueue_eventbrite_instance_sync_by_id(instance.id)
        with_details = instance_repository.get_by_id_with_details(instance.id)
        if with_details is None:
            raise NotFoundError("ServiceInstance", str(instance.id))
        bulk_reconcile_instance_capacity_status(session, [with_details])
        enrollment_counts = _capacity_commit_and_counts(
            session, instance_repository, [with_details.id]
        )
        return json_response(
            200,
            {
                "instance": serialize_instance(
                    with_details,
                    enrollment_counts_by_instance_id=enrollment_counts,
                )
            },
            event=event,
        )


def _delete_instance(
    event: Mapping[str, Any],
    *,
    service_id: UUID,
    instance_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    logger.info(
        "Deleting service instance",
        extra={
            "service_id": str(service_id),
            "instance_id": str(instance_id),
            "actor_sub": actor_sub,
        },
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = ServiceInstanceRepository(session)
        instance = repository.get_by_id(instance_id)
        if instance is None or instance.service_id != service_id:
            raise NotFoundError("ServiceInstance", str(instance_id))
        repository.delete(instance)
        session.commit()
        service_repository = ServiceRepository(session)
        service = service_repository.get_by_id(service_id)
        if service is not None and service.service_type == ServiceType.EVENT:
            enqueue_eventbrite_instance_sync_by_id(instance_id)
        return json_response(204, {}, event=event)


def _build_instance_type_details(
    service_type: ServiceType, parsed: Mapping[str, Any]
) -> Any:
    if service_type == ServiceType.TRAINING_COURSE:
        return TrainingInstanceDetails(
            training_format=TrainingFormat(parsed["training_format"].value),
            price=parsed["price"],
            currency=parsed["currency"],
            pricing_unit=parsed["pricing_unit"],
        )
    if service_type == ServiceType.EVENT:
        return [
            EventTicketTier(
                name=tier["name"],
                description=tier["description"],
                price=tier["price"],
                currency=tier["currency"],
                max_quantity=tier["max_quantity"],
                sort_order=tier["sort_order"],
            )
            for tier in parsed["event_ticket_tiers"]
        ]
    return None


def _apply_instance_type_details(
    *,
    instance: ServiceInstance,
    service_type: ServiceType,
    parsed_details: Mapping[str, Any],
) -> None:
    if service_type == ServiceType.EVENT:
        raw_tiers = parsed_details.get("event_ticket_tiers")
        if not isinstance(raw_tiers, list):
            raise ValidationError(
                "event_ticket_tiers must be an array", field="event_ticket_tiers"
            )
        tiers_data: list[dict[str, Any]] = list(raw_tiers)
        tiers_sorted = sorted(tiers_data, key=lambda d: d["sort_order"])
        existing_sorted = sorted(
            instance.ticket_tiers,
            key=lambda t: (t.sort_order, str(t.id)),
        )
        if existing_sorted and len(tiers_sorted) == len(existing_sorted):
            for tier_row, data in zip(existing_sorted, tiers_sorted, strict=True):
                tier_row.name = data["name"]
                tier_row.description = data.get("description")
                tier_row.price = data["price"]
                tier_row.currency = data["currency"]
                tier_row.max_quantity = data.get("max_quantity")
                tier_row.sort_order = data["sort_order"]
        else:
            instance.ticket_tiers.clear()
            for data in tiers_sorted:
                instance.ticket_tiers.append(
                    EventTicketTier(
                        name=data["name"],
                        description=data.get("description"),
                        price=data["price"],
                        currency=data["currency"],
                        max_quantity=data.get("max_quantity"),
                        sort_order=data["sort_order"],
                    )
                )
        instance.training_details = None
        return

    if service_type == ServiceType.TRAINING_COURSE:
        details = _build_instance_type_details(service_type, parsed_details)
        instance.training_details = details
        instance.ticket_tiers.clear()
        return

    instance.training_details = None
    instance.ticket_tiers.clear()
