"""Token-authenticated public service-instance API.

``user`` tokens may GET only. ``admin`` tokens may create, update, and delete.
Payloads match the admin instance contract. Nested enrollments are not exposed.
Create requires ``service_id`` in the body because this resource is flat
(``/v1/public/instances``) rather than nested under a service path.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import (
    parse_body,
    parse_uuid,
    route_has_prefix,
    split_route_parts,
)
from app.api.admin_service_instances import (
    _create_instance,
    _delete_instance,
    _get_instance,
    _update_instance,
)
from app.api.admin_service_instances_list import list_instances_global
from app.api.admin_services_payload_utils import parse_optional_uuid
from app.api.public.token_auth import require_api_token, token_actor_sub
from app.db.engine import get_engine
from app.db.repositories import ServiceInstanceRepository
from app.exceptions import NotFoundError, ValidationError
from app.utils import method_not_allowed, not_found


def handle_public_instances_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/public/instances routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "public", "instances"):
        return not_found(event)

    token = require_api_token(event, method)
    actor_sub = token_actor_sub(token)

    if len(parts) == 2:
        if method == "GET":
            return list_instances_global(event)
        if method == "POST":
            return _create_public_instance(event, actor_sub=actor_sub)
        return method_not_allowed(event)

    if len(parts) != 3:
        return not_found(event)

    instance_id = parse_uuid(parts[2])
    if method == "GET":
        return _get_instance(event, instance_id=instance_id)
    if method == "PUT":
        return _update_instance(
            event,
            service_id=_service_id_for_instance(instance_id),
            instance_id=instance_id,
            actor_sub=actor_sub,
        )
    if method == "DELETE":
        return _delete_instance(
            event,
            service_id=_service_id_for_instance(instance_id),
            instance_id=instance_id,
            actor_sub=actor_sub,
        )
    return method_not_allowed(event)


def _create_public_instance(
    event: Mapping[str, Any], *, actor_sub: str
) -> dict[str, Any]:
    body = parse_body(event)
    service_id = parse_optional_uuid(body.get("service_id"), "service_id")
    if service_id is None:
        raise ValidationError("service_id is required", field="service_id")
    return _create_instance(event, service_id=service_id, actor_sub=actor_sub)


def _service_id_for_instance(instance_id: UUID) -> UUID:
    with Session(get_engine()) as session:
        instance = ServiceInstanceRepository(session).get_by_id(instance_id)
        if instance is None:
            raise NotFoundError("ServiceInstance", str(instance_id))
        return instance.service_id
