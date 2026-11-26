from __future__ import annotations

from app.exceptions import ValidationError, problem_body


def test_problem_body_sets_detail_even_when_it_matches_error() -> None:
    body = problem_body(400, "Bad Request")
    assert body["error"] == "Bad Request"
    assert body["detail"] == "Bad Request"

    repeated = problem_body(400, "Bad Request", detail="Bad Request")
    assert repeated["error"] == "Bad Request"
    assert repeated["detail"] == "Bad Request"


def test_problem_body_keeps_detail_that_adds_context() -> None:
    error = ValidationError("code is required", field="code")
    body = error.to_dict()
    assert body["error"] == "code is required"
    assert body["detail"] == "Field: code"
    assert body["field"] == "code"
