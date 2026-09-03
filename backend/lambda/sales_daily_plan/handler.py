"""Lambda worker for async org-wide sales daily plans."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from app.events.sqs_batch import SqsBatchProcessor
from app.services.sales_daily_plan_runner import process_sales_daily_plan_job
from app.utils.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Process sales daily plan jobs from SQS (plain JSON body, not SNS)."""
    batch = SqsBatchProcessor(logger=logger)

    for record in event.get("Records", []):
        with batch.record(
            record,
            failure_message="Failed to process sales daily plan message",
        ):
            raw_body = record.get("body")
            if raw_body is None:
                batch.skip()
                continue
            body = json.loads(str(raw_body))
            if not isinstance(body, dict):
                batch.skip()
                continue
            job_raw = body.get("job_id")
            if not job_raw:
                batch.skip()
                continue
            outcome = process_sales_daily_plan_job(UUID(str(job_raw)))
            if outcome.ack_sqs_message:
                batch.process()
            else:
                batch.retry_record(
                    record,
                    reason="Sales daily plan job still processing; deferring SQS retry",
                )

    return batch.response()
