"""Enqueue inbox import jobs to SQS."""

from __future__ import annotations

import json
import os
from uuid import UUID

from app.services.aws_clients import get_sqs_client

# Physical name set by InboxImportNestedStack (`${resourcePrefix}-inbox-import-queue`).
_DEFAULT_QUEUE_NAME = "evolvesprouts-inbox-import-queue"


def enqueue_inbox_import_job(job_id: UUID) -> None:
    """Send an inbox import job id to the configured worker queue."""
    queue_url = os.getenv("INBOX_IMPORT_QUEUE_URL", "").strip()
    if not queue_url:
        queue_name = (
            os.getenv("INBOX_IMPORT_QUEUE_NAME", "").strip() or _DEFAULT_QUEUE_NAME
        )
        queue_url = str(
            get_sqs_client().get_queue_url(QueueName=queue_name)["QueueUrl"]
        )
    get_sqs_client().send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps({"job_id": str(job_id)}),
    )
