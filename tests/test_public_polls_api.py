"""Tests for PUT /v1/public/polls/{poll_slug}/answers."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.api import public_polls as pp
from app.services import poll_responses_store as store


@pytest.fixture(autouse=True)
def reset_poll_store() -> None:
    store.reset_table_for_tests()
    yield
    store.reset_table_for_tests()


def _event(api_gateway_event: Any, *, body: dict[str, Any]) -> dict[str, Any]:
    return api_gateway_event(
        method="PUT",
        path="/v1/public/polls/workshop-food-jun-26/answers",
        body=json.dumps(body),
        headers={"content-type": "application/json"},
    )


def _poll_control_item(
    *enabled_question_ids: str,
    question_options: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "pk": "POLL#workshop-food-jun-26",
        "sk": "CONTROL",
        "enabledQuestionIds": list(enabled_question_ids),
        "updatedAt": "2026-06-26T10:00:00Z",
    }
    if question_options is not None:
        item["questionOptions"] = question_options
    return {"Item": item}


def test_put_poll_answer_persists_select(api_gateway_event: Any, mock_env: Any) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item("role")
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "role",
        "questionType": "select",
        "selectedOption": "Parent",
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["selectedOption"] == "Parent"


def test_put_poll_answer_persists_multiselect(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item("challenge")
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "challenge",
        "questionType": "multiselect",
        "selectedOptions": [
            "My child refuses new foods",
            "Mealtimes are stressful for everyone",
        ],
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["selectedOptions"] == [
        "My child refuses new foods",
        "Mealtimes are stressful for everyone",
    ]


def test_put_poll_answer_persists_truefalse(
    api_gateway_event: Any, mock_env: Any
) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item("myth1")
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "myth1",
        "questionType": "truefalse",
        "booleanAnswer": False,
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["booleanAnswer"] is False


def test_put_poll_answer_persists_text(api_gateway_event: Any, mock_env: Any) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item("onething")
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "onething",
        "questionType": "text",
        "freeText": "Offer fruit at every meal",
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["freeText"] == "Offer fruit at every meal"


def test_put_poll_answer_persists_email(api_gateway_event: Any, mock_env: Any) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item("email")
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "email",
        "questionType": "email",
        "freeText": "parent@example.com",
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 200


def test_get_poll_session_answers_returns_session_rows(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    session_id = "550e8400-e29b-41d4-a716-446655440000"
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {
                "pollSlug": "workshop-food-jun-26",
                "sessionId": session_id,
                "questionId": "role",
                "questionType": "select",
                "selectedOption": "Parent",
                "sk": f"SESSION#{session_id}#Q#role",
            },
            {
                "pollSlug": "workshop-food-jun-26",
                "sessionId": "550e8400-e29b-41d4-a716-446655440001",
                "questionId": "challenge",
                "questionType": "select",
                "selectedOption": "Other",
                "sk": "SESSION#550e8400-e29b-41d4-a716-446655440001#Q#challenge",
            },
            {
                "pollSlug": "workshop-food-jun-26",
                "sessionId": session_id,
                "questionId": "myth1",
                "questionType": "truefalse",
                "booleanAnswer": False,
                "sk": f"SESSION#{session_id}#Q#myth1",
            },
        ],
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    event = api_gateway_event(
        method="GET",
        path="/v1/public/polls/workshop-food-jun-26/answers",
        query_params={"sessionId": session_id},
    )
    resp = pp.handle_public_polls_request(
        event,
        "GET",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["pollSlug"] == "workshop-food-jun-26"
    assert body["sessionId"] == session_id
    assert len(body["answers"]) == 2
    question_ids = {row["questionId"] for row in body["answers"]}
    assert question_ids == {"role", "myth1"}


def test_get_poll_session_answers_rejects_invalid_session(
    api_gateway_event: Any,
) -> None:
    event = api_gateway_event(
        method="GET",
        path="/v1/public/polls/workshop-food-jun-26/answers",
        query_params={"sessionId": "not-a-uuid"},
    )
    resp = pp.handle_public_polls_request(
        event,
        "GET",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 400


def test_put_poll_answer_rejects_invalid_session(api_gateway_event: Any) -> None:
    body = {
        "sessionId": "not-a-uuid",
        "questionId": "role",
        "questionType": "select",
        "selectedOption": "Parent",
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 400


def test_get_poll_question_results_aggregates_select(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {
                "questionId": "role",
                "questionType": "select",
                "selectedOption": "Parent",
            },
            {
                "questionId": "role",
                "questionType": "select",
                "selectedOption": "Parent",
            },
            {
                "questionId": "role",
                "questionType": "select",
                "selectedOption": "Grandparent",
            },
            {
                "questionId": "challenge",
                "questionType": "select",
                "selectedOption": "Other",
            },
        ],
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    event = api_gateway_event(
        method="GET",
        path="/v1/public/polls/workshop-food-jun-26/questions/role/results",
        query_params={"questionType": "select"},
    )
    resp = pp.handle_public_polls_request(
        event,
        "GET",
        "/v1/public/polls/workshop-food-jun-26/questions/role/results",
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["totalResponses"] == 3
    assert body["buckets"] == [
        {"label": "Parent", "count": 2},
        {"label": "Grandparent", "count": 1},
    ]


def test_get_poll_question_results_aggregates_multiselect(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {
                "questionId": "challenge",
                "questionType": "multiselect",
                "selectedOptions": [
                    "My child refuses new foods",
                    "Mealtimes are stressful for everyone",
                ],
            },
            {
                "questionId": "challenge",
                "questionType": "multiselect",
                "selectedOptions": ["No challenges for me"],
            },
            {
                "questionId": "challenge",
                "questionType": "multiselect",
                "selectedOptions": [
                    "My child refuses new foods",
                    "No challenges for me",
                ],
            },
        ],
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    event = api_gateway_event(
        method="GET",
        path="/v1/public/polls/workshop-food-jun-26/questions/challenge/results",
        query_params={"questionType": "multiselect"},
    )
    resp = pp.handle_public_polls_request(
        event,
        "GET",
        "/v1/public/polls/workshop-food-jun-26/questions/challenge/results",
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["totalResponses"] == 3
    assert body["buckets"] == [
        {"label": "My child refuses new foods", "count": 2},
        {"label": "No challenges for me", "count": 2},
        {"label": "Mealtimes are stressful for everyone", "count": 1},
    ]


def test_get_poll_question_results_aggregates_truefalse(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {"questionId": "myth1", "booleanAnswer": False},
            {"questionId": "myth1", "booleanAnswer": True},
            {"questionId": "myth1", "booleanAnswer": False},
        ],
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    event = api_gateway_event(
        method="GET",
        path="/v1/public/polls/workshop-food-jun-26/questions/myth1/results",
        query_params={"questionType": "truefalse"},
    )
    resp = pp.handle_public_polls_request(
        event,
        "GET",
        "/v1/public/polls/workshop-food-jun-26/questions/myth1/results",
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["totalResponses"] == 3
    assert body["buckets"] == [
        {"label": "true", "count": 1},
        {"label": "false", "count": 2},
    ]


def test_get_poll_question_results_requires_question_type(
    api_gateway_event: Any,
) -> None:
    event = api_gateway_event(
        method="GET",
        path="/v1/public/polls/workshop-food-jun-26/questions/role/results",
    )
    resp = pp.handle_public_polls_request(
        event,
        "GET",
        "/v1/public/polls/workshop-food-jun-26/questions/role/results",
    )
    assert resp["statusCode"] == 400


def test_get_poll_control_defaults_to_all_off(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.get_item.return_value = {"Item": None}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    event = api_gateway_event(
        method="GET",
        path="/v1/public/polls/workshop-food-jun-26/control",
    )
    resp = pp.handle_public_polls_request(
        event,
        "GET",
        "/v1/public/polls/workshop-food-jun-26/control",
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["enabledQuestionIds"] == []


def test_put_poll_control_persists_enabled_questions(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.get_item.return_value = {"Item": None}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    event = api_gateway_event(
        method="PUT",
        path="/v1/public/polls/workshop-food-jun-26/control",
        body=json.dumps({"enabledQuestionIds": ["role", "myth1"]}),
        headers={"content-type": "application/json"},
    )
    resp = pp.handle_public_polls_request(
        event,
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/control",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["enabledQuestionIds"] == ["role", "myth1"]
    assert item["sk"] == "CONTROL"


def test_get_poll_question_results_lists_text_responses(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {
                "questionId": "onething",
                "questionType": "text",
                "freeText": "Offer fruit daily",
            },
            {
                "questionId": "onething",
                "questionType": "text",
                "freeText": "  ",
            },
            {
                "questionId": "onething",
                "questionType": "text",
                "freeText": "Smaller portions",
            },
        ],
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    event = api_gateway_event(
        method="GET",
        path="/v1/public/polls/workshop-food-jun-26/questions/onething/results",
        query_params={"questionType": "text"},
    )
    resp = pp.handle_public_polls_request(
        event,
        "GET",
        "/v1/public/polls/workshop-food-jun-26/questions/onething/results",
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["totalResponses"] == 2
    assert body["responses"] == ["Offer fruit daily", "Smaller portions"]


def test_put_poll_answer_rejects_disabled_question(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item("role")
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "myth1",
        "questionType": "truefalse",
        "booleanAnswer": True,
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 409
    body = json.loads(resp["body"])
    assert body["error"] == "question_not_open"
    table.put_item.assert_not_called()


def test_put_poll_answer_rejects_when_poll_not_accepting(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item()
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "role",
        "questionType": "select",
        "selectedOption": "Parent",
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 409
    payload = json.loads(resp["body"])
    assert payload["error"] == "poll_not_accepting_answers"
    table.put_item.assert_not_called()


def test_put_poll_answer_rejects_unknown_path(api_gateway_event: Any) -> None:
    event = api_gateway_event(
        method="PUT",
        path="/v1/public/polls/workshop-food-jun-26/submit",
        body="{}",
        headers={"content-type": "application/json"},
    )
    resp = pp.handle_public_polls_request(
        event, "PUT", "/v1/public/polls/workshop-food-jun-26/submit"
    )
    assert resp["statusCode"] == 404


def test_put_poll_answer_rejects_option_not_in_published_list(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item(
        "role",
        question_options={
            "role": {
                "type": "select",
                "options": ["Parent", "Professional"],
            }
        },
    )
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "role",
        "questionType": "select",
        "selectedOption": "Not a real option",
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 409
    payload = json.loads(resp["body"])
    assert payload["error"] == "option_not_allowed"
    table.put_item.assert_not_called()


def test_put_poll_answer_accepts_option_in_published_list(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item(
        "role",
        question_options={
            "role": {
                "type": "select",
                "options": ["Parent", "Professional"],
            }
        },
    )
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "role",
        "questionType": "select",
        "selectedOption": "Parent",
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 200


def test_put_poll_answer_skips_option_check_without_published_options(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item("role")
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "role",
        "questionType": "select",
        "selectedOption": "Any option string",
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 200


def test_put_poll_control_persists_question_options(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.get_item.return_value = {"Item": None}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    event = api_gateway_event(
        method="PUT",
        path="/v1/public/polls/workshop-food-jun-26/control",
        body=json.dumps(
            {
                "enabledQuestionIds": ["role"],
                "questionOptions": {
                    "role": {
                        "type": "select",
                        "options": ["Parent", "Professional"],
                    }
                },
            }
        ),
        headers={"content-type": "application/json"},
    )
    resp = pp.handle_public_polls_request(
        event,
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/control",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["questionOptions"]["role"]["options"] == ["Parent", "Professional"]


def test_put_poll_answer_rejects_rate_limited_session(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.get_item.return_value = _poll_control_item("role")
    table.update_item.side_effect = _rate_limit_conditional_failure
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "role",
        "questionType": "select",
        "selectedOption": "Parent",
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 429
    payload = json.loads(resp["body"])
    assert payload["error"] == "poll_write_rate_limit_exceeded"
    table.put_item.assert_not_called()


def test_put_poll_answer_idempotent_resubmit_skips_rate_limit_and_write(
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    session_id = "550e8400-e29b-41d4-a716-446655440000"
    answer_sk = f"SESSION#{session_id}#Q#role"
    table = MagicMock()
    table.get_item.side_effect = lambda Key, **_kwargs: (
        _poll_control_item("role")
        if Key["sk"] == "CONTROL"
        else {
            "Item": {
                "pk": "POLL#workshop-food-jun-26",
                "sk": answer_sk,
                "selectedOption": "Parent",
                "updatedAt": "2026-06-01T12:00:00Z",
            }
        }
    )
    table.update_item.side_effect = _rate_limit_conditional_failure
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": session_id,
        "questionId": "role",
        "questionType": "select",
        "selectedOption": "Parent",
    }
    resp = pp.handle_public_polls_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/v1/public/polls/workshop-food-jun-26/answers",
    )
    assert resp["statusCode"] == 200
    payload = json.loads(resp["body"])
    assert payload["updatedAt"] == "2026-06-01T12:00:00Z"
    table.update_item.assert_not_called()
    table.put_item.assert_not_called()


def _rate_limit_conditional_failure(*_args: Any, **_kwargs: Any) -> None:
    from botocore.exceptions import ClientError

    raise ClientError(
        {
            "Error": {
                "Code": "ConditionalCheckFailedException",
                "Message": "conditional check failed",
            }
        },
        "UpdateItem",
    )
