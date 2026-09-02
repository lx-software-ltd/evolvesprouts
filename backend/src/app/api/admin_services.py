"""Admin service API handlers."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin_request import (
    parse_body,
    parse_uuid,
    require_admin_identity,
    split_route_parts,
)
from app.api.admin_service_instances import handle_admin_service_instances_request
from app.api.admin_service_instances_list import (
    handle_admin_all_service_instances_request,
)
from app.api.admin_services_common import (
    encode_service_cursor,
    parse_create_service_payload,
    parse_service_filters,
    parse_update_service_payload,
    request_id,
    serialize_service_detail,
    serialize_service_summary,
)
from app.api.admin_services_cover import create_cover_image_upload
from app.api.admin_services_integrity import (
    is_services_service_key_tier_unique_violation,
    service_key_tier_uniqueness_validation_error,
)
from app.api.admin_services_payload_utils import parse_service_type_details
from app.api.admin_entities_helpers import require_assignable_tag
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import (
    ConsultationDetails,
    ConsultationFormat,
    EventCategory,
    EventDetails,
    Service,
    ServiceAsset,
    ServiceTag,
    ServiceType,
    TrainingCourseDetails,
)
from app.db.repositories import (
    DiscountCodeRepository,
    ServiceInstanceRepository,
    ServiceRepository,
)
from app.exceptions import NotFoundError, ValidationError
from app.utils import json_response
from app.utils.logging import get_logger

logger = get_logger(__name__)


def handle_admin_services_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/services routes."""
    logger.info(
        "Handling admin services route",
        extra={"method": method, "path": path},
    )
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "services":
        return json_response(404, {"error": "Not found"}, event=event)

    identity = require_admin_identity(event)

    if len(parts) == 2:
        if method == "GET":
            return _list_services(event)
        if method == "POST":
            return _create_service(event, actor_sub=identity.user_sub)
        return json_response(405, {"error": "Method not allowed"}, event=event)

    if len(parts) == 3 and parts[2] == "instances":
        return handle_admin_all_service_instances_request(event, method, path)

    service_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "GET":
            return _get_service(event, service_id=service_id)
        if method == "PUT":
            return _update_service(
                event, service_id=service_id, actor_sub=identity.user_sub, partial=False
            )
        if method == "PATCH":
            return _update_service(
                event, service_id=service_id, actor_sub=identity.user_sub, partial=True
            )
        if method == "DELETE":
            return _delete_service(
                event, service_id=service_id, actor_sub=identity.user_sub
            )
        return json_response(405, {"error": "Method not allowed"}, event=event)

    if len(parts) >= 4 and parts[3] == "instances":
        return handle_admin_service_instances_request(event, method, path, service_id)

    if len(parts) == 4 and parts[3] == "discount-code-usage-summary":
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _get_discount_code_usage_summary(event, service_id=service_id)

    if len(parts) == 4 and parts[3] == "cover-image":
        if method != "POST":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return create_cover_image_upload(
            event, service_id=service_id, actor_sub=identity.user_sub
        )

    return json_response(404, {"error": "Not found"}, event=event)


def _list_services(event: Mapping[str, Any]) -> dict[str, Any]:
    filters = parse_service_filters(event)
    limit = filters["limit"]
    logger.info("Listing services", extra={"limit": limit})
    with Session(get_engine()) as session:
        repository = ServiceRepository(session)
        rows = repository.list_services(
            limit=limit + 1,
            service_type=filters["service_type"],
            status=filters["status"],
            search=filters["search"],
            cursor_title=filters["cursor_title"],
            cursor_id=filters["cursor_id"],
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        next_cursor = (
            encode_service_cursor(page_rows[-1]) if has_more and page_rows else None
        )
        total_count = repository.count_services(
            service_type=filters["service_type"],
            status=filters["status"],
            search=filters["search"],
        )
        instance_counts = repository.count_instances_by_service_ids(
            [row.id for row in page_rows]
        )
        return json_response(
            200,
            {
                "items": [
                    serialize_service_summary(
                        row, instances_count=instance_counts.get(row.id, 0)
                    )
                    for row in page_rows
                ],
                "next_cursor": next_cursor,
                "total_count": total_count,
            },
            event=event,
        )


def _create_service(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    body = parse_body(event)
    payload = parse_create_service_payload(body)
    logger.info(
        "Creating service",
        extra={
            "actor_sub": actor_sub,
            "service_type": payload["service_type"].value,
        },
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = ServiceRepository(session)
        service = Service(
            service_type=payload["service_type"],
            title=payload["title"],
            service_key=payload["service_key"],
            booking_system=payload["booking_system"],
            description=payload["description"],
            cover_image_s3_key=payload["cover_image_s3_key"],
            delivery_mode=payload["delivery_mode"],
            status=payload["status"],
            service_tier=payload["service_tier"],
            location_id=payload["location_id"],
            created_by=actor_sub,
        )
        details = _build_service_type_details(
            service_type=payload["service_type"],
            parsed_details=payload["type_details"],
        )
        try:
            created = repository.create_service(service, details)
            for tag_id in payload["tag_ids"]:
                require_assignable_tag(session, tag_id, field="tag_ids")
            created.service_tags = [
                ServiceTag(tag_id=tag_id) for tag_id in payload["tag_ids"]
            ]
            created.service_assets = [
                ServiceAsset(asset_id=asset_id) for asset_id in payload["asset_ids"]
            ]
            repository.update_service(created)
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            if is_services_service_key_tier_unique_violation(exc):
                raise service_key_tier_uniqueness_validation_error(
                    service_key=payload["service_key"],
                    service_tier=payload["service_tier"],
                ) from exc
            raise
        with_details = repository.get_by_id_with_details(created.id)
        if with_details is None:
            raise NotFoundError("Service", str(created.id))
        return json_response(
            201,
            {"service": serialize_service_detail(with_details)},
            event=event,
        )


def _get_service(event: Mapping[str, Any], *, service_id: UUID) -> dict[str, Any]:
    logger.info("Getting service", extra={"service_id": str(service_id)})
    with Session(get_engine()) as session:
        repository = ServiceRepository(session)
        service = repository.get_by_id_with_details(service_id)
        if service is None:
            raise NotFoundError("Service", str(service_id))
        return json_response(
            200,
            {"service": serialize_service_detail(service)},
            event=event,
        )


def _update_service(
    event: Mapping[str, Any],
    *,
    service_id: UUID,
    actor_sub: str,
    partial: bool,
) -> dict[str, Any]:
    body = parse_body(event)
    payload = parse_update_service_payload(body, partial=partial)
    logger.info(
        "Updating service",
        extra={
            "service_id": str(service_id),
            "actor_sub": actor_sub,
            "partial": partial,
        },
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = ServiceRepository(session)
        service = repository.get_by_id_with_details(service_id)
        if service is None:
            raise NotFoundError("Service", str(service_id))

        if "title" in payload:
            service.title = payload["title"]
        if "service_key" in payload:
            service.service_key = payload["service_key"]
        if "booking_system" in payload:
            service.booking_system = payload["booking_system"]
        if "description" in payload:
            service.description = payload["description"]
        if "cover_image_s3_key" in payload:
            service.cover_image_s3_key = payload["cover_image_s3_key"]
        if "delivery_mode" in payload:
            service.delivery_mode = payload["delivery_mode"]
        if "status" in payload:
            service.status = payload["status"]
        if "service_tier" in payload:
            service.service_tier = payload["service_tier"]
        if "location_id" in payload:
            service.location_id = payload["location_id"]
        if "tag_ids" in payload:
            for tag_id in payload["tag_ids"]:
                require_assignable_tag(session, tag_id, field="tag_ids")
            service.service_tags = [
                ServiceTag(tag_id=tag_id) for tag_id in payload["tag_ids"]
            ]
        if "asset_ids" in payload:
            service.service_assets = [
                ServiceAsset(asset_id=asset_id) for asset_id in payload["asset_ids"]
            ]
        if "type_details" in payload:
            parsed_type_details = parse_service_type_details(
                service.service_type, payload["type_details"]
            )
            parsed_details = _build_service_type_details(
                service_type=service.service_type,
                parsed_details=parsed_type_details,
            )
            _apply_service_type_details(service=service, details=parsed_details)

        try:
            updated = repository.update_service(service)
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            if is_services_service_key_tier_unique_violation(exc):
                raise service_key_tier_uniqueness_validation_error(
                    service_key=service.service_key,
                    service_tier=service.service_tier,
                ) from exc
            raise
        with_details = repository.get_by_id_with_details(updated.id)
        if with_details is None:
            raise NotFoundError("Service", str(updated.id))
        return json_response(
            200,
            {"service": serialize_service_detail(with_details)},
            event=event,
        )


def _delete_service(
    event: Mapping[str, Any],
    *,
    service_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    logger.info(
        "Deleting service",
        extra={"service_id": str(service_id), "actor_sub": actor_sub},
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = ServiceRepository(session)
        service = repository.get_by_id(service_id)
        if service is None:
            raise NotFoundError("Service", str(service_id))
        instance_repo = ServiceInstanceRepository(session)
        if instance_repo.count_for_service_id(service_id) > 0:
            raise ValidationError(
                "Cannot delete a service that has instances. Remove all instances first.",
                field="service",
                status_code=409,
            )
        repository.delete(service)
        session.commit()
        return json_response(204, {}, event=event)


def _build_service_type_details(
    *, service_type: ServiceType, parsed_details: Mapping[str, Any]
) -> Any:
    if service_type == ServiceType.TRAINING_COURSE:
        return TrainingCourseDetails(
            pricing_unit=parsed_details["pricing_unit"],
            default_price=parsed_details["default_price"],
            default_currency=parsed_details["default_currency"],
        )
    if service_type == ServiceType.EVENT:
        return EventDetails(
            event_category=EventCategory(parsed_details["event_category"].value),
            default_price=parsed_details["default_price"],
            default_currency=parsed_details["default_currency"],
        )
    return ConsultationDetails(
        consultation_format=ConsultationFormat(
            parsed_details["consultation_format"].value
        ),
        max_group_size=parsed_details["max_group_size"],
        duration_minutes=parsed_details["duration_minutes"],
        pricing_model=parsed_details["pricing_model"],
        default_hourly_rate=parsed_details["default_hourly_rate"],
        default_package_price=parsed_details["default_package_price"],
        default_package_sessions=parsed_details["default_package_sessions"],
        default_currency=parsed_details["default_currency"],
    )


def _get_discount_code_usage_summary(
    event: Mapping[str, Any], *, service_id: UUID
) -> dict[str, Any]:
    """Return aggregate discount code usage for codes scoped to this service."""
    with Session(get_engine()) as session:
        repository = ServiceRepository(session)
        if repository.get_by_id(service_id) is None:
            raise NotFoundError("Service", str(service_id))
        discount_repo = DiscountCodeRepository(session)
        total_uses, code_count = discount_repo.discount_code_usage_summary_for_service(
            service_id
        )
        return json_response(
            200,
            {
                "total_current_uses": total_uses,
                "referencing_code_count": code_count,
            },
            event=event,
        )


def _apply_service_type_details(*, service: Service, details: Any) -> None:
    if isinstance(details, TrainingCourseDetails):
        if service.training_course_details is None:
            service.training_course_details = details
        else:
            training_row = service.training_course_details
            training_row.pricing_unit = details.pricing_unit
            training_row.default_price = details.default_price
            training_row.default_currency = details.default_currency
        service.event_details = None
        service.consultation_details = None
    elif isinstance(details, EventDetails):
        if service.event_details is None:
            service.event_details = details
        else:
            event_row = service.event_details
            event_row.event_category = details.event_category
            event_row.default_price = details.default_price
            event_row.default_currency = details.default_currency
        service.training_course_details = None
        service.consultation_details = None
    else:
        if service.consultation_details is None:
            service.consultation_details = details
        else:
            consultation_row = service.consultation_details
            consultation_row.consultation_format = details.consultation_format
            consultation_row.max_group_size = details.max_group_size
            consultation_row.duration_minutes = details.duration_minutes
            consultation_row.pricing_model = details.pricing_model
            consultation_row.default_hourly_rate = details.default_hourly_rate
            consultation_row.default_package_price = details.default_package_price
            consultation_row.default_package_sessions = details.default_package_sessions
            consultation_row.default_currency = details.default_currency
        service.training_course_details = None
        service.event_details = None
