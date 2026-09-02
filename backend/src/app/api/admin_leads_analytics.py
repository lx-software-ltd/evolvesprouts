"""Admin lead analytics handler."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.api.admin_leads_common import (
    count_leads_in_window,
    max_datetime,
    min_datetime,
    parse_optional_datetime,
)
from app.api.admin_request import (
    query_param,
)
from app.db.engine import get_engine
from app.db.repositories import (
    SalesLeadRepository,
)
from app.utils import json_response


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
