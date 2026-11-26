from __future__ import annotations

from app.exceptions import ValidationError, problem_body


def test_problem_body_omits_detail_that_repeats_error() -> None:
    body = problem_body(400, "Bad Request")
    assert body["error"] == "Bad Request"
    assert "detail" not in body

    repeated = problem_body(400, "Bad Request", detail="Bad Request")
    assert repeated["error"] == "Bad Request"
    assert "detail" not in repeated


def test_problem_body_keeps_detail_that_adds_context() -> None:
    error = ValidationError("code is required", field="code")
    body = error.to_dict()
    assert body["error"] == "code is required"
    assert body["detail"] == "Field: code"
    assert body["field"] == "code"
