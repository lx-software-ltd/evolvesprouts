"""Tests for inbox import SQS enqueue helpers."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.inbox_import_events import enqueue_inbox_import_job


def test_enqueue_resolves_default_queue_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[dict[str, object]] = []

    class _FakeSqs:
        def get_queue_url(self, *, QueueName: str) -> dict[str, str]:
            assert QueueName == "evolvesprouts-inbox-import-queue"
            return {"QueueUrl": "https://sqs.example/inbox-import"}

        def send_message(self, **kwargs: object) -> None:
            sent.append(kwargs)

    monkeypatch.delenv("INBOX_IMPORT_QUEUE_URL", raising=False)
    monkeypatch.delenv("INBOX_IMPORT_QUEUE_NAME", raising=False)
    monkeypatch.setattr(
        "app.services.inbox_import_events.get_sqs_client", lambda: _FakeSqs()
    )

    job_id = uuid4()
    enqueue_inbox_import_job(job_id)
    assert sent[0]["QueueUrl"] == "https://sqs.example/inbox-import"
    assert str(job_id) in str(sent[0]["MessageBody"])


def test_enqueue_uses_explicit_queue_url(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[dict[str, object]] = []

    class _FakeSqs:
        def send_message(self, **kwargs: object) -> None:
            sent.append(kwargs)

    monkeypatch.setenv("INBOX_IMPORT_QUEUE_URL", "https://sqs.example/explicit")
    monkeypatch.setattr(
        "app.services.inbox_import_events.get_sqs_client", lambda: _FakeSqs()
    )
    enqueue_inbox_import_job(uuid4())
    assert sent[0]["QueueUrl"] == "https://sqs.example/explicit"
