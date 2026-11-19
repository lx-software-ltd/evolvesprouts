"""Tests for scheduled incremental Meta Graph sync enqueue."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db.models.enums import MetaChannel
from app.db.models.inbox_import_job import InboxImportKind, InboxImportJobStatus
from app.services import meta_graph_sync_schedule as schedule


def test_enqueue_scheduled_meta_graph_sync_creates_incremental_jobs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[object] = []
    enqueued: list[object] = []

    class _Repo:
        def __init__(self, _session: object) -> None:
            pass

        def find_in_flight_for_channel(self, *, kind, channel):
            return None

    class _Session:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def add(self, job):
            job.id = uuid4()
            created.append(job)

        def flush(self):
            return None

        def commit(self):
            return None

    monkeypatch.setattr(schedule, "Session", lambda _engine: _Session())
    monkeypatch.setattr(schedule, "get_engine", lambda: object())
    monkeypatch.setattr(schedule, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(schedule, "InboxImportJobRepository", _Repo)
    monkeypatch.setattr(
        schedule,
        "enqueue_inbox_import_job",
        lambda job_id: enqueued.append(job_id),
    )

    job_ids = schedule.enqueue_scheduled_meta_graph_sync(request_id="req-1")
    assert len(job_ids) == 2
    assert len(enqueued) == 2
    assert {job.channel for job in created} == {
        MetaChannel.INSTAGRAM,
        MetaChannel.FACEBOOK,
    }
    assert all(job.kind is InboxImportKind.META_GRAPH for job in created)
    assert all(job.options == {"incremental": True} for job in created)
    assert all(job.status is InboxImportJobStatus.PENDING for job in created)
    assert all(
        job.created_by == schedule.META_GRAPH_SYNC_SCHEDULE_AUDIT_USER_ID
        for job in created
    )


def test_enqueue_skips_channel_with_in_flight_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[object] = []

    class _Repo:
        def __init__(self, _session: object) -> None:
            pass

        def find_in_flight_for_channel(self, *, kind, channel):
            if channel is MetaChannel.INSTAGRAM:
                return SimpleNamespace(id=uuid4(), status=InboxImportJobStatus.PENDING)
            return None

    class _Session:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def add(self, job):
            job.id = uuid4()
            created.append(job)

        def flush(self):
            return None

        def commit(self):
            return None

    monkeypatch.setattr(schedule, "Session", lambda _engine: _Session())
    monkeypatch.setattr(schedule, "get_engine", lambda: object())
    monkeypatch.setattr(schedule, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(schedule, "InboxImportJobRepository", _Repo)
    monkeypatch.setattr(schedule, "enqueue_inbox_import_job", lambda _job_id: None)

    job_ids = schedule.enqueue_scheduled_meta_graph_sync(request_id="req-2")
    assert len(job_ids) == 1
    assert created[0].channel is MetaChannel.FACEBOOK
