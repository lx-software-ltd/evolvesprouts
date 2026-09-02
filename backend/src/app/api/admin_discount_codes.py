"""Admin discount-code API handlers."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
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
from app.api.admin_services_common import (
    encode_discount_code_cursor,
    parse_create_discount_code_payload,
    parse_discount_code_filters,
    parse_update_discount_code_payload,
    request_id,
    serialize_discount_code,
)
from app.api.admin_services_payloads import (
    REFERRAL_DEFAULT_CURRENCY,
    REFERRAL_DEFAULT_DISCOUNT_VALUE,
    ensure_discount_validity_window,
)
from app.api.discount_scope_validation import ensure_discount_code_scope
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import DiscountCode
from app.db.models.enums import DiscountType
from app.db.repositories import DiscountCodeRepository
from app.exceptions import NotFoundError, ValidationError
from app.utils import json_response
from app.utils.logging import get_logger

logger = get_logger(__name__)


def handle_admin_discount_codes_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/discount-codes routes."""
    logger.info(
        "Handling admin discount-codes route",
        extra={"method": method, "path": path},
    )
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "discount-codes":
        return json_response(404, {"error": "Not found"}, event=event)

    identity = require_admin_identity(event)

    if len(parts) == 2:
        if method == "GET":
            return _list_discount_codes(event)
        if method == "POST":
            return _create_discount_code(event, actor_sub=identity.user_sub)
        return json_response(405, {"error": "Method not allowed"}, event=event)

    code_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "PUT":
            return _update_discount_code(
                event, code_id=code_id, actor_sub=identity.user_sub
            )
        if method == "DELETE":
            return _delete_discount_code(
                event, code_id=code_id, actor_sub=identity.user_sub
            )
        return json_response(405, {"error": "Method not allowed"}, event=event)

    return json_response(404, {"error": "Not found"}, event=event)


def _list_discount_codes(event: Mapping[str, Any]) -> dict[str, Any]:
    filters = parse_discount_code_filters(event)
    limit = filters["limit"]
    logger.info(
        "Listing discount codes",
        extra={
            "limit": limit,
            "active": filters["active"],
            "service_id": str(filters["service_id"]) if filters["service_id"] else None,
            "instance_id": str(filters["instance_id"])
            if filters["instance_id"]
            else None,
        },
    )
    with Session(get_engine()) as session:
        repository = DiscountCodeRepository(session)
        rows = repository.list_codes(
            limit=limit + 1,
            active=filters["active"],
            service_id=filters["service_id"],
            instance_id=filters["instance_id"],
            scope=filters["scope"],
            search=filters["search"],
            cursor_created_at=filters["cursor_created_at"],
            cursor_id=filters["cursor_id"],
        )
        total_count = repository.count_codes(
            active=filters["active"],
            service_id=filters["service_id"],
            instance_id=filters["instance_id"],
            scope=filters["scope"],
            search=filters["search"],
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        next_cursor = (
            encode_discount_code_cursor(page_rows[-1])
            if has_more and page_rows
            else None
        )
        return json_response(
            200,
            {
                "items": [serialize_discount_code(row) for row in page_rows],
                "next_cursor": next_cursor,
                "total_count": total_count,
            },
            event=event,
        )


def _create_discount_code(
    event: Mapping[str, Any], *, actor_sub: str
) -> dict[str, Any]:
    body = parse_body(event)
    payload = parse_create_discount_code_payload(body)
    logger.info(
        "Creating discount code",
        extra={
            "actor_sub": actor_sub,
            "service_id": str(payload["service_id"]) if payload["service_id"] else None,
            "instance_id": str(payload["instance_id"])
            if payload["instance_id"]
            else None,
        },
    )
    with Session(get_engine()) as session:
        ensure_discount_code_scope(
            session,
            service_id=payload["service_id"],
            instance_id=payload["instance_id"],
        )
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = DiscountCodeRepository(session)
        entity = DiscountCode(
            code=payload["code"],
            description=payload["description"],
            discount_type=payload["discount_type"],
            discount_value=payload["discount_value"],
            currency=payload["currency"],
            valid_from=payload["valid_from"],
            valid_until=payload["valid_until"],
            service_id=payload["service_id"],
            instance_id=payload["instance_id"],
            max_uses=payload["max_uses"],
            active=payload["active"] if payload["active"] is not None else True,
            created_by=actor_sub,
        )
        created = repository.create(entity)
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            if _is_discount_code_unique_violation(exc):
                raise ValidationError(
                    "A discount code with this value already exists",
                    field="code",
                    status_code=409,
                ) from exc
            raise
        return json_response(
            201,
            {"discount_code": serialize_discount_code(created)},
            event=event,
        )


def _is_discount_code_unique_violation(exc: IntegrityError) -> bool:
    orig = getattr(exc.orig, "__cause__", None) or exc.orig
    diag = getattr(orig, "diag", None)
    constraint = getattr(diag, "constraint_name", None) if diag else None
    if constraint == "discount_codes_code_unique_idx":
        return True
    message = str(exc).lower()
    return "discount_codes_code_unique_idx" in message


def _update_discount_code(
    event: Mapping[str, Any],
    *,
    code_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    payload = parse_update_discount_code_payload(body)
    logger.info(
        "Updating discount code",
        extra={"code_id": str(code_id), "actor_sub": actor_sub},
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = DiscountCodeRepository(session)
        code = repository.get_by_id(code_id)
        if code is None:
            raise NotFoundError("DiscountCode", str(code_id))

        merged_from = (
            payload["valid_from"] if "valid_from" in payload else code.valid_from
        )
        merged_until = (
            payload["valid_until"] if "valid_until" in payload else code.valid_until
        )
        ensure_discount_validity_window(merged_from, merged_until)

        effective_type = (
            payload["discount_type"]
            if "discount_type" in payload
            else code.discount_type
        )
        if (
            effective_type != DiscountType.REFERRAL
            and "discount_value" in payload
            and payload["discount_value"] <= Decimal("0")
        ):
            raise ValidationError(
                "discount_value must be greater than 0",
                field="discount_value",
            )
        if effective_type == DiscountType.REFERRAL:
            payload["discount_value"] = REFERRAL_DEFAULT_DISCOUNT_VALUE
            payload["currency"] = REFERRAL_DEFAULT_CURRENCY

        if "description" in payload:
            code.description = payload["description"]
        if "discount_type" in payload:
            code.discount_type = payload["discount_type"]
        if "discount_value" in payload:
            code.discount_value = payload["discount_value"]
        if "currency" in payload:
            code.currency = payload["currency"]
        if "valid_from" in payload:
            code.valid_from = payload["valid_from"]
        if "valid_until" in payload:
            code.valid_until = payload["valid_until"]
        if "service_id" in payload:
            code.service_id = payload["service_id"]
        if "instance_id" in payload:
            code.instance_id = payload["instance_id"]
        if "max_uses" in payload:
            code.max_uses = payload["max_uses"]
        if "active" in payload:
            code.active = payload["active"]

        merged_service = (
            payload["service_id"] if "service_id" in payload else code.service_id
        )
        merged_instance = (
            payload["instance_id"] if "instance_id" in payload else code.instance_id
        )
        ensure_discount_code_scope(
            session,
            service_id=merged_service,
            instance_id=merged_instance,
        )

        updated = repository.update(code)
        session.commit()
        return json_response(
            200,
            {"discount_code": serialize_discount_code(updated)},
            event=event,
        )


def _delete_discount_code(
    event: Mapping[str, Any],
    *,
    code_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    logger.info(
        "Deleting discount code",
        extra={"code_id": str(code_id), "actor_sub": actor_sub},
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = DiscountCodeRepository(session)
        code = repository.get_by_id(code_id)
        if code is None:
            raise NotFoundError("DiscountCode", str(code_id))
        repository.delete(code)
        session.commit()
        return json_response(204, {}, event=event)
