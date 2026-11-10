from __future__ import annotations

import io
import json
import logging

from app.utils.logging import StructuredLogFormatter


def test_structured_formatter_merges_logger_extra_into_json() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(StructuredLogFormatter())
    log = logging.getLogger("test_structured_formatter_extra")
    log.handlers.clear()
    log.propagate = False
    log.addHandler(handler)
    log.setLevel(logging.WARNING)

    log.warning(
        "OpenRouter request failed",
        extra={"status_code": 404, "response_preview": '{"error":"model"}'},
    )

    line = stream.getvalue().strip()
    data = json.loads(line)
    assert data["message"] == "OpenRouter request failed"
    assert data["status_code"] == 404
    assert data["response_preview"] == '{"error":"model"}'


def _capture_exception(exc: BaseException) -> dict[str, object]:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(StructuredLogFormatter())
    log = logging.getLogger(f"test_structured_formatter_{type(exc).__name__}")
    log.handlers.clear()
    log.propagate = False
    log.addHandler(handler)
    log.setLevel(logging.ERROR)
    try:
        raise exc
    except type(exc):
        log.exception("request failed")
    return json.loads(stream.getvalue().strip())


def test_structured_formatter_keeps_application_exception_text() -> None:
    data = _capture_exception(ValueError("stage name missing"))
    exception = data["exception"]
    assert isinstance(exception, dict)
    assert exception["type"] == "ValueError"
    assert exception["message"] == "stage name missing"
    assert "stage name missing" in "".join(exception["traceback"])


def test_structured_formatter_redacts_database_parameters() -> None:
    class _DatabaseError(Exception):
        def __str__(self) -> str:
            return (
                "duplicate key value violates unique constraint "
                '"whatsapp_conversations_wa_id_idx"\n'
                "DETAIL:  Key (wa_id)=(85290000000) already exists.\n"
                "[SQL: INSERT INTO whatsapp_conversations]\n"
                "[parameters: {'wa_id': '85290000000', 'profile_name': 'Example Name'}]"
            )

    raw_data = _capture_exception(_DatabaseError())
    encoded = json.dumps(raw_data)
    assert "85290000000" not in encoded
    assert "Example Name" not in encoded
    assert "[SQL:" not in encoded
    assert "[parameters:" not in encoded
    exception = raw_data["exception"]
    assert isinstance(exception, dict)
    assert exception["type"] == "_DatabaseError"
    assert exception["message"] == (
        "database constraint whatsapp_conversations_wa_id_idx"
    )


def test_structured_formatter_keeps_unrelated_detail_text() -> None:
    data = _capture_exception(RuntimeError("DETAIL: cache refreshed"))
    exception = data["exception"]
    assert isinstance(exception, dict)
    assert exception["message"] == "DETAIL: cache refreshed"


def test_structured_formatter_keeps_cause_chain_and_redacts_database_text() -> None:
    class _DatabaseError(Exception):
        def __str__(self) -> str:
            return (
                "duplicate key value violates unique constraint "
                '"whatsapp_conversations_wa_id_idx"\n'
                "DETAIL:  Key (wa_id)=(85290000000) already exists.\n"
                "[parameters: {'wa_id': '85290000000'}]"
            )

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(StructuredLogFormatter())
    log = logging.getLogger("test_structured_formatter_cause_chain")
    log.handlers.clear()
    log.propagate = False
    log.addHandler(handler)
    log.setLevel(logging.ERROR)
    try:
        try:
            raise _DatabaseError()
        except _DatabaseError as exc:
            raise RuntimeError("webhook failed") from exc
    except RuntimeError:
        log.exception("request failed")

    data = json.loads(stream.getvalue().strip())
    encoded = json.dumps(data)
    assert "85290000000" not in encoded
    exception = data["exception"]
    assert isinstance(exception, dict)
    assert exception["type"] == "RuntimeError"
    assert exception["message"] == "webhook failed"
    traceback_text = "".join(exception["traceback"])
    assert "webhook failed" in traceback_text
    assert "database constraint whatsapp_conversations_wa_id_idx" in traceback_text
    assert (
        "The above exception was the direct cause of the following exception:"
        in traceback_text
    )
