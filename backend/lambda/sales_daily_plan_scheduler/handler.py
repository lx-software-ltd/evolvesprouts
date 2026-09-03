"""EventBridge entrypoint that queues the daily sales plan of the day."""

from __future__ import annotations

from typing import Any

from app.services.sales_daily_plan_schedule import (
    SCHEDULE_REQUEST_ID_PREFIX,
    enqueue_scheduled_sales_daily_plan,
)
from app.utils.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Create and enqueue a sales daily plan job for the 06:00 HKT schedule."""
    del event
    aws_request_id = getattr(context, "aws_request_id", "") or "unknown"
    request_id = f"{SCHEDULE_REQUEST_ID_PREFIX}:{aws_request_id}"
    job_id = enqueue_scheduled_sales_daily_plan(request_id=request_id)
    if job_id is None:
        logger.info("Scheduled sales daily plan skipped")
        return {"statusCode": 200, "skipped": True}
    return {"statusCode": 202, "skipped": False, "job_id": str(job_id)}
