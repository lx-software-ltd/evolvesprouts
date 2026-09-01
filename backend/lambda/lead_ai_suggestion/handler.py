"""Lambda worker for async lead AI close suggestions."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from app.events.sqs_batch import SqsBatchProcessor
from app.services.lead_ai_suggestion_runner import process_lead_ai_suggestion_job
from app.utils.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Process lead AI suggestion jobs from SQS (plain JSON body, not SNS)."""
    batch = SqsBatchProcessor(logger=logger)

    for record in event.get("Records", []):
        with batch.record(
            record,
            failure_message="Failed to process lead AI suggestion message",
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
            outcome = process_lead_ai_suggestion_job(UUID(str(job_raw)))
            if outcome.ack_sqs_message:
                batch.process()
            else:
                batch.retry_record(
                    record,
                    reason="Lead AI suggestion job still processing; deferring SQS retry",
                )

    return batch.response()
