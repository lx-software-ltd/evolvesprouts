"""Hong Kong business-day boundaries for insight memory."""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

BUSINESS_TZ = ZoneInfo("Asia/Hong_Kong")
BUSINESS_DAY_START = time(6, 0)


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def in_business_tz(value: datetime) -> datetime:
    return as_utc(value).astimezone(BUSINESS_TZ)


def next_business_day_start(now: datetime) -> datetime:
    """Next 06:00 HKT at or after ``now`` (exclusive of the current instant)."""
    local = in_business_tz(now)
    boundary = datetime.combine(local.date(), BUSINESS_DAY_START, tzinfo=BUSINESS_TZ)
    if local >= boundary:
        boundary += timedelta(days=1)
    return boundary.astimezone(UTC)


def current_business_day_start(now: datetime) -> datetime:
    """06:00 HKT that opened the business day containing ``now``."""
    local = in_business_tz(now)
    boundary = datetime.combine(local.date(), BUSINESS_DAY_START, tzinfo=BUSINESS_TZ)
    if local < boundary:
        boundary -= timedelta(days=1)
    return boundary.astimezone(UTC)
