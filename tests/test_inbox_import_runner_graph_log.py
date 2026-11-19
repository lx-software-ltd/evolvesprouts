"""Inbox import runner logs Graph failure metadata."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db.models.inbox_import_job import InboxImportJobStatus, InboxImportKind
from app.services import inbox_import_runner as runner
from app.services.meta_graph_client import MetaGraphApiError


def test_process_inbox_import_logs_graph_error_fields(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    job_id = uuid4()
    job = SimpleNamespace(
        id=job_id,
        status=InboxImportJobStatus.PENDING,
        kind=InboxImportKind.META_GRAPH,
        channel=None,
        updated_at=None,
        created_at=None,
        counters=None,
        error_message=None,
    )

    class _Repo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id(self, _job_id):
            return job

        def mark_processing(self, current):
            current.status = InboxImportJobStatus.PROCESSING
            return current

        def mark_failed(self, current, message):
            current.status = InboxImportJobStatus.FAILED
            current.error_message = message
            return current

    class _Session:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def commit(self):
            return None

    monkeypatch.setattr(runner, "Session", lambda _engine: _Session())
    monkeypatch.setattr(runner, "get_engine", lambda: object())
    monkeypatch.setattr(runner, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(runner, "InboxImportJobRepository", _Repo)

    def _boom(_job_id):
        raise MetaGraphApiError(
            status_code=400,
            message="Meta Graph request failed (400): Fatal",
            code=-1,
            error_subcode=2207085,
            fbtrace_id="trace-log-1",
            is_transient=False,
        )

    monkeypatch.setattr(runner, "_run_job", _boom)

    with caplog.at_level("WARNING"):
        outcome = runner.process_inbox_import_job(job_id)

    assert outcome.ack_sqs_message is True
    assert job.status is InboxImportJobStatus.FAILED
    assert any(
        "Inbox import Graph failure" in record.message
        and getattr(record, "status_code", None) == 400
        or (
            "Inbox import Graph failure" in record.message
            and "trace-log-1" in str(getattr(record, "fbtrace_id", ""))
        )
        for record in caplog.records
    )
    # Prefer structured extras when the logging adapter exposes them.
    matching = [r for r in caplog.records if "Inbox import Graph failure" in r.message]
    assert matching
    record = matching[0]
    extras = getattr(record, "graph_error_code", None)
    if extras is None and hasattr(record, "__dict__"):
        # get_logger may put fields on the record via extra=
        assert record.__dict__.get("graph_error_code") == -1
        assert record.__dict__.get("graph_error_subcode") == 2207085
        assert record.__dict__.get("fbtrace_id") == "trace-log-1"
        assert record.__dict__.get("status_code") == 400
