"""EventBridge entrypoint that queues incremental Meta Graph inbox imports."""

from __future__ import annotations

from typing import Any

from app.services.meta_graph_sync_schedule import (
    SCHEDULE_REQUEST_ID_PREFIX,
    enqueue_scheduled_meta_graph_sync,
)
from app.utils.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Create and enqueue incremental meta_graph jobs for each channel."""
    del event
    aws_request_id = getattr(context, "aws_request_id", "") or "unknown"
    request_id = f"{SCHEDULE_REQUEST_ID_PREFIX}:{aws_request_id}"
    job_ids = enqueue_scheduled_meta_graph_sync(request_id=request_id)
    if not job_ids:
        logger.info("Scheduled Meta Graph sync skipped for all channels")
        return {"statusCode": 200, "skipped": True, "job_ids": []}
    return {
        "statusCode": 202,
        "skipped": False,
        "job_ids": [str(job_id) for job_id in job_ids],
    }
