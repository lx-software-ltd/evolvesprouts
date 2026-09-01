"""Enqueue lead AI suggestion jobs to SQS."""

from __future__ import annotations

import json
import os
from uuid import UUID

from app.exceptions import ValidationError
from app.services.aws_clients import get_sqs_client

# Physical name set by MessagingNestedStack (`${resourcePrefix}-lead-ai-suggestion-queue`).
_DEFAULT_QUEUE_NAME = "evolvesprouts-lead-ai-suggestion-queue"


def enqueue_lead_ai_suggestion_job(job_id: UUID) -> None:
    """Send a lead AI suggestion job id to the configured worker queue."""
    queue_url = os.getenv("LEAD_AI_SUGGESTION_QUEUE_URL", "").strip()
    if not queue_url:
        queue_name = (
            os.getenv("LEAD_AI_SUGGESTION_QUEUE_NAME", "").strip()
            or _DEFAULT_QUEUE_NAME
        )
        try:
            queue_url = str(
                get_sqs_client().get_queue_url(QueueName=queue_name)["QueueUrl"]
            )
        except Exception as exc:
            raise ValidationError(
                "Lead AI suggestion queue is not configured",
                field="configuration",
            ) from exc
    get_sqs_client().send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps({"job_id": str(job_id)}),
    )
