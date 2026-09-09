"""Token-authenticated public services API.

``user`` tokens may GET only. ``admin`` tokens may create, update, and delete.
Routes match the admin services tree under ``/v1/public/services``. Payloads
match the admin service contract. Cover-image upload, discount-code usage
summary, and instance enrollments are not exposed.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.api.admin_request import parse_uuid, route_has_prefix, split_route_parts
from app.api.admin_service_instances_list import list_instances_global
from app.api.admin_services import (
    create_service,
    delete_service,
    get_service,
    list_services,
    update_service,
)
from app.api.public.instances import handle_public_service_instances_request
from app.api.public.token_auth import require_api_token, token_actor_sub
from app.utils import method_not_allowed, not_found


def handle_public_services_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/public/services routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "public", "services"):
        return not_found(event)

    token = require_api_token(event, method)
    actor_sub = token_actor_sub(token)

    if len(parts) == 2:
        if method == "GET":
            return list_services(event)
        if method == "POST":
            return create_service(event, actor_sub=actor_sub)
        return method_not_allowed(event)

    if len(parts) == 3 and parts[2] == "instances":
        if method == "GET":
            return list_instances_global(event)
        return method_not_allowed(event)

    service_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "GET":
            return get_service(event, service_id=service_id)
        if method == "PUT":
            return update_service(
                event, service_id=service_id, actor_sub=actor_sub, partial=False
            )
        if method == "PATCH":
            return update_service(
                event, service_id=service_id, actor_sub=actor_sub, partial=True
            )
        if method == "DELETE":
            return delete_service(event, service_id=service_id, actor_sub=actor_sub)
        return method_not_allowed(event)

    if len(parts) >= 4 and parts[3] == "instances":
        return handle_public_service_instances_request(
            event,
            method,
            path,
            service_id=service_id,
            actor_sub=actor_sub,
        )

    return not_found(event)
