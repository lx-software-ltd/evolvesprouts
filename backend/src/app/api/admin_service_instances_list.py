"""Cross-service admin instance list (GET /v1/admin/services/instances)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from app.api.admin_contacts_related import enrollment_instance_ids_for_contact
from app.api.admin_party_related import (
    enrollment_instance_ids_for_family,
    enrollment_instance_ids_for_organization,
)
from app.api.admin_request import require_admin_identity, split_route_parts
from app.api.admin_service_instances import _capacity_commit_and_counts
from app.api.admin_services_common import (
    encode_instance_cursor,
    parse_global_instance_list_filters,
    serialize_instance,
)
from app.api.instance_capacity_status import bulk_reconcile_instance_capacity_status
from app.db.engine import get_engine
from app.db.repositories import ServiceInstanceRepository, ServiceRepository
from app.exceptions import NotFoundError
from app.utils import json_response
from app.utils.logging import get_logger

logger = get_logger(__name__)


def handle_admin_all_service_instances_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle GET /v1/admin/services/instances (cross-service list)."""
    logger.info(
        "Handling admin all service-instances route",
        extra={"method": method, "path": path},
    )
    parts = split_route_parts(path)
    if len(parts) != 3 or parts[0] != "admin" or parts[1] != "services":
        return json_response(404, {"error": "Not found"}, event=event)
    if parts[2] != "instances":
        return json_response(404, {"error": "Not found"}, event=event)

    require_admin_identity(event)

    if method != "GET":
        return json_response(405, {"error": "Method not allowed"}, event=event)

    filters = parse_global_instance_list_filters(event)
    limit = filters["limit"]
    service_id_filter = filters["service_id"]
    service_type_filter = filters["service_type"]
    contact_id_filter = filters.get("contact_id")
    family_id_filter = filters.get("family_id")
    organization_id_filter = filters.get("organization_id")
    logger.info(
        "Listing service instances (global)",
        extra={
            "limit": limit,
            "service_id": str(service_id_filter) if service_id_filter else None,
            "service_type": service_type_filter.value if service_type_filter else None,
            "contact_id": str(contact_id_filter) if contact_id_filter else None,
            "family_id": str(family_id_filter) if family_id_filter else None,
            "organization_id": (
                str(organization_id_filter) if organization_id_filter else None
            ),
        },
    )
    with Session(get_engine()) as session:
        if service_id_filter is not None:
            service_repository = ServiceRepository(session)
            service = service_repository.get_by_id(service_id_filter)
            if service is None:
                raise NotFoundError("Service", str(service_id_filter))

        if contact_id_filter is not None:
            instance_ids = enrollment_instance_ids_for_contact(
                session, contact_id_filter
            )
        elif family_id_filter is not None:
            instance_ids = enrollment_instance_ids_for_family(session, family_id_filter)
        elif organization_id_filter is not None:
            instance_ids = enrollment_instance_ids_for_organization(
                session, organization_id_filter
            )
        else:
            instance_ids = None
        repository = ServiceInstanceRepository(session)
        rows = repository.list_instances_global(
            limit=limit + 1,
            status=filters["status"],
            service_id=service_id_filter,
            service_type=service_type_filter,
            cursor_created_at=filters["cursor_created_at"],
            cursor_id=filters["cursor_id"],
            instance_ids=instance_ids,
        )
        total_count = repository.count_instances_global(
            status=filters["status"],
            service_id=service_id_filter,
            service_type=service_type_filter,
            instance_ids=instance_ids,
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
