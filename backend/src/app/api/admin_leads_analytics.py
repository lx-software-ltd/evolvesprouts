"""Admin lead analytics and CSV export handlers."""

from __future__ import annotations

import csv
import io
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_leads_common import (
    count_leads_in_window,
    max_datetime,
    min_datetime,
    parse_lead_filters,
    parse_optional_datetime,
    serialize_lead_summary,
)
from app.api.admin_request import (
    query_param,
)
from app.db.engine import get_engine
from app.db.repositories import (
    SalesLeadRepository,
)
from app.utils import json_response
from app.utils.responses import get_cors_headers, get_security_headers


def get_analytics(event: Mapping[str, Any]) -> dict[str, Any]:
    date_from = parse_optional_datetime(query_param(event, "date_from"), "date_from")
    date_to = parse_optional_datetime(query_param(event, "date_to"), "date_to")

    with Session(get_engine()) as session:
        repository = SalesLeadRepository(session)
        base = repository.get_analytics(date_from=date_from, date_to=date_to)
        now = datetime.now(UTC)
        week_start = datetime.combine(
            (now - timedelta(days=now.weekday())).date(),
            datetime.min.time(),
            tzinfo=UTC,
        )
        month_start = datetime.combine(
            date(now.year, now.month, 1),
            datetime.min.time(),
            tzinfo=UTC,
        )
        week_window_start = max_datetime(date_from, week_start)
        week_window_end = min_datetime(date_to, now)
        month_window_start = max_datetime(date_from, month_start)
        month_window_end = min_datetime(date_to, now)
        leads_this_week = count_leads_in_window(
            repository,
            date_from=week_window_start,
            date_to=week_window_end,
        )
        leads_this_month = count_leads_in_window(
            repository,
            date_from=month_window_start,
            date_to=month_window_end,
        )
        return json_response(
            200,
            {
                **base,
                "leads_this_week": leads_this_week,
                "leads_this_month": leads_this_month,
            },
            event=event,
        )


def export_leads(event: Mapping[str, Any]) -> dict[str, Any]:
    filters = parse_lead_filters(event)
    with Session(get_engine()) as session:
        repository = SalesLeadRepository(session)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "ID",
                "First Name",
                "Last Name",
                "Email",
                "Phone E.164",
                "Source",
                "Lead Type",
                "Stage",
                "Assigned To",
                "Created",
                "Last Activity",
                "Days In Stage",
                "Tags",
            ]
        )
        cursor_created_at: datetime | None = None
        cursor_id: UUID | None = None
        while True:
            rows = repository.list_leads(
                limit=500,
                stage=filters["stage"],
                source=filters["source"],
                lead_type=filters["lead_type"],
                assigned_to=filters["assigned_to"],
                unassigned=filters["unassigned"],
                date_from=filters["date_from"],
                date_to=filters["date_to"],
                search=filters["search"],
                sort="created_at",
                sort_dir="desc",
                cursor_created_at=cursor_created_at,
                cursor_id=cursor_id,
            )
            if not rows:
                break

            for lead in rows:
                summary = serialize_lead_summary(lead)
                contact = summary["contact"]
                writer.writerow(
                    [
                        summary["id"],
                        contact["first_name"],
                        contact["last_name"],
                        contact["email"],
                        contact["phone_e164"],
                        contact["source"],
                        summary["lead_type"],
                        summary["funnel_stage"],
                        summary["assigned_to"],
                        summary["created_at"],
                        summary["last_activity_at"],
                        summary["days_in_stage"],
                        ",".join(summary["tags"]),
                    ]
                )
            if len(rows) < 500:
                break
            cursor_created_at = rows[-1].created_at
            cursor_id = rows[-1].id

        filename = f"leads-export-{datetime.now(UTC).date().isoformat()}.csv"
        response_headers = {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": f'attachment; filename="{filename}"',
            **get_security_headers(),
            **get_cors_headers(event),
        }
        return {
            "statusCode": 200,
            "headers": response_headers,
            "body": output.getvalue(),
        }
