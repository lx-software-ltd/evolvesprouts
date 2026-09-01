"""Enqueue lead AI suggestion jobs to SQS."""

from __future__ import annotations

import json
import os
from uuid import UUID

from app.exceptions import ValidationError
from app.services.aws_clients import get_sqs_client


def enqueue_lead_ai_suggestion_job(job_id: UUID) -> None:
    """Send a lead AI suggestion job id to the configured worker queue."""
    queue_url = os.getenv("LEAD_AI_SUGGESTION_QUEUE_URL", "").strip()
    if not queue_url:
        raise ValidationError(
            "Lead AI suggestion queue is not configured", field="configuration"
        )
    get_sqs_client().send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps({"job_id": str(job_id)}),
    )
