"""Token-authenticated public nested service-instance API.

``user`` tokens may GET only. ``admin`` tokens may create, update, and delete.
Routes match the admin instance tree under ``/v1/public/services/{id}/instances``.
Payloads match the admin instance contract. Nested enrollments are not exposed.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.api.admin_request import parse_uuid, split_route_parts
from app.api.admin_service_instances import (
    _create_instance,
    _delete_instance,
    _get_instance,
    _list_instances,
    _update_instance,
)
from app.utils import method_not_allowed, not_found


def handle_public_service_instances_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
    *,
    service_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    """Handle /v1/public/services/{id}/instances routes."""
    parts = split_route_parts(path)
    if len(parts) < 4 or parts[3] != "instances":
        return not_found(event)

    if len(parts) == 4:
        if method == "GET":
            return _list_instances(event, service_id=service_id)
        if method == "POST":
            return _create_instance(event, service_id=service_id, actor_sub=actor_sub)
        return method_not_allowed(event)

    instance_id = parse_uuid(parts[4])
    if len(parts) == 5:
        if method == "GET":
            return _get_instance(event, instance_id=instance_id, service_id=service_id)
        if method == "PUT":
            return _update_instance(
                event,
                service_id=service_id,
                instance_id=instance_id,
                actor_sub=actor_sub,
            )
        if method == "DELETE":
            return _delete_instance(
                event,
                service_id=service_id,
                instance_id=instance_id,
                actor_sub=actor_sub,
            )
        return method_not_allowed(event)

    return not_found(event)
