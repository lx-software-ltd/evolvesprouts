from __future__ import annotations

import json
from typing import Any

import pytest

from app.services import openrouter_client
from app.services import openrouter_expense_parser as parser


class _FakeBody:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


def _set_common_env(monkeypatch: Any) -> None:
    monkeypatch.setenv(
        "OPENROUTER_CHAT_COMPLETIONS_URL",
        "https://openrouter.ai/api/v1/chat/completions",
    )
    monkeypatch.setenv("OPENROUTER_MODEL", "openai/gpt-4.1-mini")
    monkeypatch.setenv("OPENROUTER_API_KEY_SECRET_ARN", "arn:aws:secretsmanager:test")
    monkeypatch.setenv("ASSETS_BUCKET_NAME", "assets-bucket")
    parser._api_key_cache = None


def _mock_secrets(monkeypatch: Any) -> None:
    class _FakeSecretsClient:
        def get_secret_value(self, SecretId: str) -> dict[str, str]:
            assert SecretId == "arn:aws:secretsmanager:test"
            return {"SecretString": json.dumps({"openrouter_api_key": "test-key"})}

    monkeypatch.setattr(
        parser,
        "get_secretsmanager_client",
        lambda: _FakeSecretsClient(),
    )
    monkeypatch.setattr(
        openrouter_client,
        "get_secretsmanager_client",
        lambda: _FakeSecretsClient(),
    )
    openrouter_client._api_key_cache = None


def test_parse_invoice_sends_images_as_image_url(monkeypatch: Any) -> None:
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            assert Bucket == "assets-bucket"
            assert Key == "uploads/invoice.png"
            return {"Body": _FakeBody(b"png-bytes")}

    captured_request: dict[str, Any] = {}

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        captured_request.update(kwargs)
        return {
            "status": 200,
            "body": json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "vendor_name": "Acme Co",
                                        "invoice_number": None,
                                        "invoice_date": None,
                                        "due_date": None,
                                        "currency": "USD",
                                        "subtotal": 10,
                                        "tax": 0,
                                        "total": 10,
                                        "line_items": [],
                                        "confidence": 0.8,
                                    }
                                )
                            }
                        }
                    ]
                }
            ),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    parser.parse_invoice_from_assets(
        [
            {
                "id": "asset-1",
                "s3_key": "uploads/invoice.png",
                "file_name": "invoice.png",
                "content_type": "image/png",
            }
        ]
    )

    payload = json.loads(captured_request["body"])
    user_content = payload["messages"][1]["content"]
    image_input = user_content[1]

    assert image_input["type"] == "image_url"
    assert image_input["image_url"]["url"].startswith("data:image/png;base64,")
    assert "plugins" not in payload
    assert "response_format" not in payload, (
        "JSON mode is intentionally NOT set; see _openrouter_chat_completion "
        "docstring for the rationale tied to commits 3874b3b6 and b6f8990b."
    )


def test_parse_invoice_sends_pdfs_as_file_with_explicit_plugin(
    monkeypatch: Any,
) -> None:
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            assert Bucket == "assets-bucket"
            assert Key == "uploads/invoice.pdf"
            return {"Body": _FakeBody(b"%PDF-1.4")}

    captured_request: dict[str, Any] = {}

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        captured_request.update(kwargs)
        return {
            "status": 200,
            "body": json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "vendor_name": "Acme Co",
                                        "invoice_number": None,
                                        "invoice_date": None,
                                        "due_date": None,
                                        "currency": "USD",
                                        "subtotal": 10,
                                        "tax": 0,
                                        "total": 10,
                                        "line_items": [],
                                        "confidence": 0.9,
                                    }
                                )
                            }
                        }
                    ]
                }
            ),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    parser.parse_invoice_from_assets(
        [
            {
                "id": "asset-2",
                "s3_key": "uploads/invoice.pdf",
                "file_name": "invoice.pdf",
                "content_type": "application/pdf",
            }
        ]
    )

    payload = json.loads(captured_request["body"])
    user_content = payload["messages"][1]["content"]
    file_input = user_content[1]

    assert file_input["type"] == "file"
    assert file_input["file"]["file_data"].startswith("data:application/pdf;base64,")
    assert payload["plugins"] == [
        {
            "id": "file-parser",
            "pdf": {"engine": "mistral-ocr"},
        }
    ]


def test_parse_invoice_sends_plain_text_body_as_text_block(monkeypatch: Any) -> None:
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)
    text_bytes = b"Invoice INV-T\nTotal 42.00 USD\n"

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            assert Bucket == "assets-bucket"
            assert Key == "uploads/email-invoice-body.txt"
            return {"Body": _FakeBody(text_bytes)}

    captured_request: dict[str, Any] = {}

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        captured_request.update(kwargs)
        return {
            "status": 200,
            "body": json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "vendor_name": "Text Vendor",
                                        "invoice_number": "INV-T",
                                        "invoice_date": None,
                                        "due_date": None,
                                        "currency": "USD",
                                        "subtotal": None,
                                        "tax": None,
                                        "total": 42,
                                        "line_items": [],
                                        "confidence": 0.5,
                                    }
                                )
                            }
                        }
                    ]
                }
            ),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    parser.parse_invoice_from_assets(
        [
            {
                "id": "asset-txt",
                "s3_key": "uploads/email-invoice-body.txt",
                "file_name": "email-invoice-body.txt",
                "content_type": "text/plain",
            }
        ]
    )

    payload = json.loads(captured_request["body"])
    user_content = payload["messages"][1]["content"]
    text_input = user_content[1]

    assert text_input["type"] == "text"
    assert text_input["text"] == text_bytes.decode("utf-8")
    assert "plugins" not in payload


def test_parse_invoice_uses_configured_pdf_engine(monkeypatch: Any) -> None:
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)
    monkeypatch.setenv("OPENROUTER_PDF_ENGINE", "pdf-text")

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.7")}

    captured_request: dict[str, Any] = {}

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        captured_request.update(kwargs)
        return {
            "status": 200,
            "body": json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": '{"vendor_name": null, "invoice_number": null,'
                                ' "invoice_date": null, "due_date": null, "currency": null,'
                                ' "subtotal": null, "tax": null, "total": null,'
                                ' "line_items": [], "confidence": null}'
                            }
                        }
                    ]
                }
            ),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    parser.parse_invoice_from_assets(
        [
            {
                "id": "asset-3",
                "s3_key": "uploads/invoice-two.pdf",
                "file_name": "invoice-two.pdf",
                "content_type": "application/pdf",
            }
        ]
    )

    payload = json.loads(captured_request["body"])
    assert payload["plugins"][0]["pdf"]["engine"] == "pdf-text"


def test_normalize_result_parses_currency_formatted_total() -> None:
    out = parser._normalize_result(
        {
            "vendor_name": "Acme",
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": "USD",
            "subtotal": None,
            "tax": None,
            "total": "$1,234.56",
            "line_items": [],
            "confidence": None,
        }
    )
    assert out["total"] == 1234.56


def test_normalize_result_maps_amount_key_to_total() -> None:
    out = parser._normalize_result(
        {
            "vendor_name": None,
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": None,
            "subtotal": None,
            "tax": None,
            "total": None,
            "amount": "€ 99,00",
            "line_items": [],
            "confidence": None,
        }
    )
    assert out["total"] == 99.0


def test_normalize_result_total_from_line_items_when_total_missing() -> None:
    out = parser._normalize_result(
        {
            "vendor_name": None,
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": None,
            "subtotal": None,
            "tax": None,
            "total": None,
            "line_items": [
                {
                    "description": "A",
                    "quantity": 1,
                    "unit_price": 10,
                    "amount": "10.00",
                },
                {"description": "B", "quantity": 1, "unit_price": 5, "amount": "$5.00"},
            ],
            "confidence": None,
        }
    )
    assert out["total"] == 15.0
    assert out["currency"] == "USD"


def test_normalize_result_maps_currency_dollar_sign_to_usd() -> None:
    out = parser._normalize_result(
        {
            "vendor_name": None,
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": "$",
            "subtotal": None,
            "tax": None,
            "total": 30,
            "line_items": [],
            "confidence": None,
        }
    )
    assert out["currency"] == "USD"


def test_normalize_result_infers_usd_from_plain_dollar_total_string() -> None:
    out = parser._normalize_result(
        {
            "vendor_name": None,
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": None,
            "subtotal": None,
            "tax": None,
            "total": "$30.00",
            "line_items": [],
            "confidence": None,
        }
    )
    assert out["currency"] == "USD"


def test_normalize_result_does_not_infer_usd_for_hk_dollar() -> None:
    out = parser._normalize_result(
        {
            "vendor_name": None,
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": None,
            "subtotal": None,
            "tax": None,
            "total": "HK$100.00",
            "line_items": [],
            "confidence": None,
        }
    )
    assert out["currency"] is None


def test_normalize_result_does_not_infer_usd_when_euro_marker_present() -> None:
    out = parser._normalize_result(
        {
            "vendor_name": None,
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": None,
            "subtotal": "€10.00",
            "tax": None,
            "total": "$5.00",
            "line_items": [],
            "confidence": None,
        }
    )
    assert out["currency"] is None


def test_parse_invoice_surfaces_openrouter_error_body(monkeypatch: Any) -> None:
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"x")}

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        return {
            "status": 404,
            "body": '{"error":{"message":"No endpoints found for google/gpt-4"}}',
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    with pytest.raises(RuntimeError) as exc_info:
        parser.parse_invoice_from_assets(
            [
                {
                    "id": "asset-e",
                    "s3_key": "k",
                    "file_name": "i.png",
                    "content_type": "image/png",
                }
            ]
        )

    assert "404" in str(exc_info.value)
    assert "No endpoints found" in str(exc_info.value)


def test_parse_bulk_expense_invoices_normalizes_each_row(monkeypatch: Any) -> None:
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.4")}

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        assert kwargs["timeout"] == 25
        payload = json.loads(kwargs["body"])
        assert payload["plugins"][0]["id"] == "file-parser"
        return {
            "status": 200,
            "body": json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "invoices": [
                                            {
                                                "vendor_name": "Shop A",
                                                "invoice_number": "1",
                                                "invoice_date": "2026-01-02",
                                                "due_date": None,
                                                "currency": "HKD",
                                                "subtotal": 10,
                                                "tax": 0,
                                                "total": 10,
                                                "line_items": [],
                                                "confidence": 0.9,
                                            },
                                            {
                                                "vendor_name": "Shop B",
                                                "invoice_number": "2",
                                                "invoice_date": "2026-01-03",
                                                "due_date": None,
                                                "currency": "HKD",
                                                "subtotal": 20,
                                                "tax": 0,
                                                "total": 20,
                                                "line_items": [],
                                                "confidence": 0.8,
                                            },
                                        ]
                                    }
                                )
                            }
                        }
                    ]
                }
            ),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    rows = parser.parse_bulk_expense_invoices_from_assets(
        [
            {
                "id": "asset-b",
                "s3_key": "k",
                "file_name": "bulk.pdf",
                "content_type": "application/pdf",
            }
        ],
        timeout=25,
    )
    assert len(rows) == 2
    assert rows[0]["invoice_number"] == "1"
    assert rows[0]["total"] == 10.0
    assert rows[1]["vendor_name"] == "Shop B"


def _bulk_chat_completion_body(content_text: str) -> str:
    return json.dumps(
        {
            "choices": [
                {
                    "message": {
                        "content": content_text,
                    }
                }
            ]
        }
    )


def test_parse_bulk_expense_invoices_does_not_set_json_response_format(
    monkeypatch: Any,
) -> None:
    """Bulk parse must NOT force JSON mode.

    See ``_openrouter_chat_completion`` docstring: JSON mode (commit
    3874b3b6) caused models to emit empty ``{}`` / ``completion_tokens=0``
    responses on borderline PDFs, which is the exact cascade the user
    flagged when migrating to async. The same ``JSONDecodeError`` it was
    introduced to mask is now handled by the ``loads_openrouter_json``
    pathway, so the request payload reverts to the original sync-era shape
    from commit b6f8990b.
    """
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.4")}

    captured_payloads: list[dict[str, Any]] = []

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        captured_payloads.append(json.loads(kwargs["body"]))
        return {
            "status": 200,
            "body": _bulk_chat_completion_body(
                json.dumps(
                    {
                        "invoices": [
                            {
                                "vendor_name": "Shop",
                                "invoice_number": "1",
                                "invoice_date": "2026-01-01",
                                "due_date": None,
                                "currency": "HKD",
                                "subtotal": 1,
                                "tax": 0,
                                "total": 1,
                                "line_items": [],
                                "confidence": 0.9,
                            }
                        ]
                    }
                )
            ),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    parser.parse_bulk_expense_invoices_from_assets(
        [
            {
                "id": "asset-rf",
                "s3_key": "k",
                "file_name": "bulk.pdf",
                "content_type": "application/pdf",
            }
        ],
        timeout=25,
    )

    assert len(captured_payloads) == 1
    assert "response_format" not in captured_payloads[0]


def test_parse_bulk_expense_invoices_repairs_invalid_json(monkeypatch: Any) -> None:
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.4")}

    valid_payload = {
        "invoices": [
            {
                "vendor_name": "Shop",
                "invoice_number": "1",
                "invoice_date": "2026-02-03",
                "due_date": None,
                "currency": "HKD",
                "subtotal": 5,
                "tax": 0,
                "total": 5,
                "line_items": [
                    {
                        "description": 'Apple iPhone 15 "Pro" case 6.1"',
                        "quantity": 1,
                        "unit_price": 5,
                        "amount": 5,
                    }
                ],
                "confidence": 0.9,
            }
        ]
    }
    # Hand-crafted broken JSON (unescaped inner quote in description) that mimics
    # the production failure mode.
    broken_text = (
        '{"invoices": [{"vendor_name": "Shop", "invoice_number": "1",'
        ' "invoice_date": "2026-02-03", "due_date": null, "currency": "HKD",'
        ' "subtotal": 5, "tax": 0, "total": 5,'
        ' "line_items": [{"description": "Apple iPhone 15 "Pro" case 6.1"",'
        ' "quantity": 1, "unit_price": 5, "amount": 5}],'
        ' "confidence": 0.9}]}'
    )

    call_log: list[dict[str, Any]] = []

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        payload = json.loads(kwargs["body"])
        call_log.append(payload)
        if len(call_log) == 1:
            return {
                "status": 200,
                "body": _bulk_chat_completion_body(broken_text),
            }
        return {
            "status": 200,
            "body": _bulk_chat_completion_body(json.dumps(valid_payload)),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)
    monkeypatch.setattr(openrouter_client, "http_invoke", _fake_http_invoke)

    rows = parser.parse_bulk_expense_invoices_from_assets(
        [
            {
                "id": "asset-repair",
                "s3_key": "k",
                "file_name": "bulk.pdf",
                "content_type": "application/pdf",
            }
        ],
        timeout=25,
    )

    assert len(call_log) == 2, "expected one initial call plus one repair call"
    repair_call = call_log[1]
    assert "plugins" not in repair_call, "repair call must not re-attach the PDF plugin"
    repair_user_content = repair_call["messages"][1]["content"]
    if isinstance(repair_user_content, list):
        repair_user_text = repair_user_content[0]["text"]
    else:
        repair_user_text = str(repair_user_content)
    assert "BROKEN_JSON_BEGIN" in repair_user_text
    assert "Apple iPhone 15" in repair_user_text
    assert len(rows) == 1
    assert rows[0]["invoice_number"] == "1"
    assert rows[0]["total"] == 5.0


def test_coerce_bulk_invoice_list_passes_through_top_level_array() -> None:
    rows = [{"vendor_name": "A"}, {"vendor_name": "B"}]
    assert parser._coerce_bulk_invoice_list(rows) is rows


def test_coerce_bulk_invoice_list_accepts_alias_keys() -> None:
    rows = [{"vendor_name": "A"}]
    for key in ("invoices", "records", "data", "results", "rows", "expenses"):
        assert parser._coerce_bulk_invoice_list({key: rows}) == rows


def test_coerce_bulk_invoice_list_uses_single_unknown_list_of_dicts() -> None:
    rows = [{"vendor_name": "Acme", "total": 10}]
    out = parser._coerce_bulk_invoice_list({"meta": {"page_count": 1}, "things": rows})
    assert out == rows


def test_coerce_bulk_invoice_list_picks_most_invoice_like_when_multiple() -> None:
    invoice_like = [{"vendor_name": "Acme", "total": 1}]
    decoy = [{"some_other": "value"}]
    out = parser._coerce_bulk_invoice_list({"noise": decoy, "best_match": invoice_like})
    assert out == invoice_like


def test_coerce_bulk_invoice_list_wraps_single_top_level_invoice() -> None:
    single = {"vendor_name": "Acme", "total": 10, "currency": "USD"}
    out = parser._coerce_bulk_invoice_list(single)
    assert out == [single]


def test_coerce_bulk_invoice_list_treats_empty_object_as_no_rows() -> None:
    assert parser._coerce_bulk_invoice_list({}) == []


def test_coerce_bulk_invoice_list_raises_with_keys_preview_on_unknown_shape() -> None:
    with pytest.raises(RuntimeError) as exc_info:
        parser._coerce_bulk_invoice_list({"alpha": "x", "beta": 2, "gamma": [1, 2, 3]})
    msg = str(exc_info.value)
    assert "alpha" in msg
    assert "beta" in msg
    assert "gamma" in msg


def test_parse_bulk_expense_invoices_accepts_data_alias(monkeypatch: Any) -> None:
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.4")}

    payload_text = json.dumps(
        {
            "data": [
                {
                    "vendor_name": "Shop X",
                    "invoice_number": "9",
                    "invoice_date": "2026-03-04",
                    "due_date": None,
                    "currency": "USD",
                    "subtotal": 8,
                    "tax": 0,
                    "total": 8,
                    "line_items": [],
                    "confidence": 0.9,
                }
            ]
        }
    )

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        return {
            "status": 200,
            "body": _bulk_chat_completion_body(payload_text),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    rows = parser.parse_bulk_expense_invoices_from_assets(
        [
            {
                "id": "asset-data",
                "s3_key": "k",
                "file_name": "bulk.pdf",
                "content_type": "application/pdf",
            }
        ],
        timeout=25,
    )
    assert len(rows) == 1
    assert rows[0]["vendor_name"] == "Shop X"
    assert rows[0]["total"] == 8.0


def test_extract_message_text_raises_on_top_level_error_object() -> None:
    body = json.dumps({"error": {"message": "Upstream model overloaded", "code": 503}})
    with pytest.raises(RuntimeError) as exc_info:
        parser._extract_message_text(body)
    msg = str(exc_info.value)
    assert "Upstream model overloaded" in msg
    assert "503" in msg


def test_extract_message_text_raises_on_refusal() -> None:
    body = json.dumps(
        {
            "choices": [
                {
                    "message": {
                        "content": None,
                        "refusal": "I cannot extract personal data from this document.",
                    }
                }
            ]
        }
    )
    with pytest.raises(RuntimeError) as exc_info:
        parser._extract_message_text(body)
    assert "Model refused to extract" in str(exc_info.value)
    assert "personal data" in str(exc_info.value)


def test_extract_message_text_raises_on_empty_content_with_truncation_hint() -> None:
    body = json.dumps(
        {
            "choices": [
                {
                    "message": {"content": ""},
                    "finish_reason": "length",
                }
            ],
            "usage": {"completion_tokens": 0},
        }
    )
    with pytest.raises(RuntimeError) as exc_info:
        parser._extract_message_text(body)
    msg = str(exc_info.value)
    assert "truncated" in msg
    assert "finish_reason=length" in msg


def test_extract_message_text_raises_on_empty_content_with_stop_finish() -> None:
    body = json.dumps(
        {
            "choices": [
                {
                    "message": {"content": None},
                    "finish_reason": "stop",
                }
            ]
        }
    )
    with pytest.raises(RuntimeError) as exc_info:
        parser._extract_message_text(body)
    msg = str(exc_info.value)
    assert "empty response" in msg
    assert "finish_reason=stop" in msg


def test_bulk_schema_prompt_is_simplified_and_handles_single_invoice() -> None:
    """The bulk prompt must mirror the single parser's tone and explicitly
    permit single-invoice documents (one-element array)."""
    prompt = parser._bulk_schema_prompt()
    assert "single-element array" in prompt
    assert (
        "card statement" not in prompt
    ), "removed verbose example that nudged the model into empty responses"
    assert (
        "Include every billable row" not in prompt
    ), "removed aggressive instruction that correlated with empty model output"
    assert "skip blank pages" not in prompt


def test_parse_bulk_expense_invoices_makes_one_request_like_single_parser(
    monkeypatch: Any,
) -> None:
    """Bulk parse must mirror the single-invoice parser: one OpenRouter call.

    Doing multiple back-to-back calls (the previous engine-fallback design)
    amplifies a transient provider rate limit into a guaranteed failure
    across every retry.
    """
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.4")}

    captured_calls: list[dict[str, Any]] = []

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        captured_calls.append(kwargs)
        return {
            "status": 200,
            "body": _bulk_chat_completion_body(
                json.dumps(
                    {
                        "invoices": [
                            {
                                "vendor_name": "Once Shop",
                                "invoice_number": "1",
                                "invoice_date": "2026-05-15",
                                "due_date": None,
                                "currency": "USD",
                                "subtotal": 4,
                                "tax": 0,
                                "total": 4,
                                "line_items": [],
                                "confidence": 0.9,
                            }
                        ]
                    }
                )
            ),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    rows = parser.parse_bulk_expense_invoices_from_assets(
        [
            {
                "id": "asset-once",
                "s3_key": "k",
                "file_name": "bulk.pdf",
                "content_type": "application/pdf",
            }
        ],
        timeout=25,
    )

    assert len(captured_calls) == 1
    sent_payload = json.loads(captured_calls[0]["body"])
    assert sent_payload["messages"][0]["content"] == (
        "You extract invoice data and return strict JSON only."
    ), "bulk parser must use the same system prompt as the single-invoice parser"
    assert len(rows) == 1
    assert rows[0]["vendor_name"] == "Once Shop"


def test_parse_bulk_expense_invoices_falls_back_to_single_on_provider_error(
    monkeypatch: Any,
) -> None:
    """A persistent 429 on the bulk call falls back to the single parser.

    Each chat-completion call retries up to ``_MAX_RETRY_ATTEMPTS - 1`` times
    on retryable upstream failures, so a hard-failure scenario where every
    attempt returns 429 issues:

    - 3 attempts on the bulk call (initial + 2 retries), then
    - 3 attempts on the single-invoice fallback (single shape, no engine
      chain; see commit reverting JSON mode + engine fallback for details).

    = 6 ``http_invoke`` calls total before surfacing a combined error that
    names both failures so neither is hidden.
    """
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)
    monkeypatch.setattr(parser, "_RETRY_BACKOFF_SCHEDULE_SECONDS", ())

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.4")}

    call_count = {"n": 0}

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        call_count["n"] += 1
        return {
            "status": 429,
            "body": '{"error":{"message":"Provider returned error","code":429}}',
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    with pytest.raises(RuntimeError) as exc_info:
        parser.parse_bulk_expense_invoices_from_assets(
            [
                {
                    "id": "asset-429",
                    "s3_key": "k",
                    "file_name": "bulk.pdf",
                    "content_type": "application/pdf",
                }
            ],
            timeout=25,
        )

    assert call_count["n"] == 6, (
        "expected (bulk x 3 attempts) + (single fallback first engine x 3 "
        "attempts) = 6 http_invoke calls"
    )
    msg = str(exc_info.value)
    assert "Bulk parse failed" in msg
    assert "single-invoice fallback also failed" in msg
    assert "status 429" in msg


def test_openrouter_chat_completion_retries_once_on_429_then_succeeds(
    monkeypatch: Any,
) -> None:
    """A 429 on the first attempt is retried once and the second response is used."""
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)
    monkeypatch.setattr(parser, "_RETRY_BACKOFF_SCHEDULE_SECONDS", ())

    call_log: list[dict[str, Any]] = []

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        call_log.append(kwargs)
        if len(call_log) == 1:
            return {
                "status": 429,
                "body": '{"error":{"message":"Rate limited","code":429}}',
            }
        return {
            "status": 200,
            "body": _bulk_chat_completion_body('{"ok": true}'),
        }

    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    body = parser._openrouter_chat_completion(
        system_prompt="s",
        user_content_blocks=[{"type": "text", "text": "t"}],
        has_pdf_attachment=False,
        timeout=5,
    )

    assert len(call_log) == 2, "expected one initial call + one retry"
    assert '"ok": true' in parser._extract_message_text(body)


def test_openrouter_chat_completion_retries_on_envelope_504_in_2xx(
    monkeypatch: Any,
) -> None:
    """A 200 response carrying an envelope ``error.code=504`` is retried.

    Mirrors the second leg of the user-reported failure:
        ``OpenRouter returned error: The operation was aborted (code=504)``
    """
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)
    monkeypatch.setattr(parser, "_RETRY_BACKOFF_SCHEDULE_SECONDS", ())

    call_log: list[dict[str, Any]] = []

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        call_log.append(kwargs)
        if len(call_log) == 1:
            return {
                "status": 200,
                "body": json.dumps(
                    {
                        "error": {
                            "message": "The operation was aborted",
                            "code": 504,
                        }
                    }
                ),
            }
        return {
            "status": 200,
            "body": _bulk_chat_completion_body('{"recovered": true}'),
        }

    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    body = parser._openrouter_chat_completion(
        system_prompt="s",
        user_content_blocks=[{"type": "text", "text": "t"}],
        has_pdf_attachment=False,
        timeout=5,
    )

    assert len(call_log) == 2
    assert '"recovered": true' in parser._extract_message_text(body)


def test_openrouter_chat_completion_does_not_retry_on_400(monkeypatch: Any) -> None:
    """A 400 (non-retryable) is surfaced immediately without a second attempt."""
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)
    monkeypatch.setattr(parser, "_RETRY_BACKOFF_SCHEDULE_SECONDS", ())

    call_log: list[dict[str, Any]] = []

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        call_log.append(_kwargs)
        return {
            "status": 400,
            "body": '{"error":{"message":"Bad request","code":400}}',
        }

    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    with pytest.raises(RuntimeError) as exc_info:
        parser._openrouter_chat_completion(
            system_prompt="s",
            user_content_blocks=[{"type": "text", "text": "t"}],
            has_pdf_attachment=False,
            timeout=5,
        )

    assert len(call_log) == 1, "non-retryable status must not be retried"
    assert "status 400" in str(exc_info.value)


def test_openrouter_chat_completion_persistent_429_raises_after_all_retries(
    monkeypatch: Any,
) -> None:
    """When every attempt returns 429 the final error still carries the status.

    With ``_MAX_RETRY_ATTEMPTS = 3`` (initial + 2 retries) we expect exactly
    3 ``http_invoke`` calls before the final ``RuntimeError`` propagates.
    """
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)
    monkeypatch.setattr(parser, "_RETRY_BACKOFF_SCHEDULE_SECONDS", ())

    call_log: list[dict[str, Any]] = []

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        call_log.append(_kwargs)
        return {
            "status": 429,
            "body": '{"error":{"message":"Provider returned error","code":429}}',
        }

    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    with pytest.raises(RuntimeError) as exc_info:
        parser._openrouter_chat_completion(
            system_prompt="s",
            user_content_blocks=[{"type": "text", "text": "t"}],
            has_pdf_attachment=False,
            timeout=5,
        )

    assert len(call_log) == parser._MAX_RETRY_ATTEMPTS == 3
    msg = str(exc_info.value)
    assert "status 429" in msg
    assert "Provider returned error" in msg


def test_openrouter_chat_completion_honors_retry_after_header(
    monkeypatch: Any,
) -> None:
    """``Retry-After`` (in seconds) is honored, capped to ``_MAX_RETRY_AFTER_SECONDS``."""
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    sleep_calls: list[float] = []
    monkeypatch.setattr(parser.time, "sleep", lambda s: sleep_calls.append(s))

    call_log: list[dict[str, Any]] = []

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        call_log.append(_kwargs)
        if len(call_log) == 1:
            return {
                "status": 503,
                "headers": {"Retry-After": "2"},
                "body": '{"error":{"message":"Service unavailable","code":503}}',
            }
        return {
            "status": 200,
            "body": _bulk_chat_completion_body('{"ok":true}'),
        }

    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    parser._openrouter_chat_completion(
        system_prompt="s",
        user_content_blocks=[{"type": "text", "text": "t"}],
        has_pdf_attachment=False,
        timeout=5,
    )

    assert len(call_log) == 2
    assert sleep_calls == [
        2.0
    ], "expected the Retry-After value (2s) to be used as the backoff"


def test_retry_delay_seconds_caps_excessive_retry_after() -> None:
    delay = parser._retry_delay_seconds({"Retry-After": "60"}, attempt=1)
    assert delay == parser._MAX_RETRY_AFTER_SECONDS


def test_retry_delay_seconds_uses_exponential_schedule_when_no_retry_after() -> None:
    """Without a ``Retry-After`` header the exponential schedule is used."""
    schedule = parser._RETRY_BACKOFF_SCHEDULE_SECONDS
    assert len(schedule) >= parser._MAX_RETRY_ATTEMPTS - 1
    for attempt_index, expected in enumerate(schedule, start=1):
        assert parser._retry_delay_seconds({}, attempt=attempt_index) == expected
    assert parser._retry_delay_seconds({}, attempt=len(schedule) + 5) == schedule[-1]


def test_envelope_error_code_returns_none_for_non_json_or_no_error() -> None:
    assert parser._envelope_error_code("") is None
    assert parser._envelope_error_code("not json") is None
    assert parser._envelope_error_code("{}") is None
    assert parser._envelope_error_code('{"error":"plain string"}') is None
    assert parser._envelope_error_code('{"error":{"message":"x","code":429}}') == 429


def test_parse_bulk_expense_invoices_recovers_via_single_when_bulk_returns_empty(
    monkeypatch: Any,
) -> None:
    """When the bulk call returns empty content, the single fallback recovers.

    This is the scenario the user reported (model returned 0 tokens on the
    bulk call). The single-invoice parser is given a shot at the same PDF
    and any extracted invoice is returned wrapped as a one-element list.
    """
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.4")}

    empty_body = json.dumps(
        {
            "choices": [
                {
                    "message": {"content": ""},
                    "finish_reason": "stop",
                }
            ]
        }
    )
    single_body = _bulk_chat_completion_body(
        json.dumps(
            {
                "vendor_name": "Recovered Shop",
                "invoice_number": "REC1",
                "invoice_date": "2026-05-15",
                "due_date": None,
                "currency": "USD",
                "subtotal": 9,
                "tax": 0,
                "total": 9,
                "line_items": [],
                "confidence": 0.85,
            }
        )
    )

    call_count = {"n": 0}

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        call_count["n"] += 1
        # Call 1 is the bulk attempt (returns empty).
        # Call 2 is the single-invoice fallback (succeeds).
        if call_count["n"] == 1:
            return {"status": 200, "body": empty_body}
        return {"status": 200, "body": single_body}

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    rows = parser.parse_bulk_expense_invoices_from_assets(
        [
            {
                "id": "asset-empty-content",
                "s3_key": "k",
                "file_name": "bulk.pdf",
                "content_type": "application/pdf",
            }
        ],
        timeout=25,
    )

    assert call_count["n"] == 2, "expected bulk + single-fallback = 2 calls"
    assert len(rows) == 1
    assert rows[0]["vendor_name"] == "Recovered Shop"
    assert rows[0]["total"] == 9.0


def test_format_openrouter_error_preview_extracts_message_and_code() -> None:
    body = (
        '{"error":{"message":"Failed to parse Evolve Sprouts Invoices.pdf",'
        '"code":400,"metadata":{"provider_name":null}},'
        '"user_id":"user_3B4yKT1KyjP6dHEWd77RJxoki98"}'
    )
    preview = parser._format_openrouter_error_preview(body)
    assert preview == "Failed to parse Evolve Sprouts Invoices.pdf (code=400)"
    assert "user_id" not in preview
    assert "metadata" not in preview


def test_format_openrouter_error_preview_handles_plain_string_error() -> None:
    assert (
        parser._format_openrouter_error_preview('{"error":"rate limited"}')
        == "rate limited"
    )


def test_format_openrouter_error_preview_falls_back_for_non_json() -> None:
    body = "Internal Server Error\nrequest-id: abc"
    out = parser._format_openrouter_error_preview(body)
    assert "Internal Server Error" in out
    assert "request-id: abc" in out


def test_openrouter_chat_completion_4xx_raises_clean_error(monkeypatch: Any) -> None:
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    body = (
        '{"error":{"message":"Failed to parse Evolve Sprouts Invoices.pdf",'
        '"code":400,"metadata":{"provider_name":null}},'
        '"user_id":"user_3B4yKT1KyjP6dHEWd77RJxoki98"}'
    )

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        return {"status": 400, "body": body}

    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    with pytest.raises(RuntimeError) as exc_info:
        parser._openrouter_chat_completion(
            system_prompt="s",
            user_content_blocks=[{"type": "text", "text": "t"}],
            has_pdf_attachment=False,
            timeout=5,
        )
    msg = str(exc_info.value)
    assert "status 400" in msg
    assert "Failed to parse Evolve Sprouts Invoices.pdf" in msg
    assert "code=400" in msg
    assert "user_id" not in msg
    assert "metadata" not in msg


def test_parse_bulk_expense_invoices_falls_back_to_single_when_model_returns_empty_object(
    monkeypatch: Any,
) -> None:
    """An empty {} (zero rows) triggers the single-invoice fallback."""
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.4")}

    bulk_body = _bulk_chat_completion_body("{}")
    single_body = _bulk_chat_completion_body(
        json.dumps(
            {
                "vendor_name": "Solo Shop",
                "invoice_number": "S1",
                "invoice_date": "2026-05-15",
                "due_date": None,
                "currency": "USD",
                "subtotal": 3,
                "tax": 0,
                "total": 3,
                "line_items": [],
                "confidence": 0.7,
            }
        )
    )

    call_count = {"n": 0}

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return {"status": 200, "body": bulk_body}
        return {"status": 200, "body": single_body}

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    rows = parser.parse_bulk_expense_invoices_from_assets(
        [
            {
                "id": "asset-empty",
                "s3_key": "k",
                "file_name": "bulk.pdf",
                "content_type": "application/pdf",
            }
        ],
        timeout=25,
    )

    assert call_count["n"] == 2
    assert len(rows) == 1
    assert rows[0]["vendor_name"] == "Solo Shop"


def test_parse_bulk_expense_invoices_raises_with_snippet_when_repair_fails(
    monkeypatch: Any,
) -> None:
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.4")}

    broken_text = (
        '{"invoices": [{"vendor_name": "Shop A", "description":'
        ' "MARKER_TOKEN "Pro" model"}]}'
    )

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        return {
            "status": 200,
            "body": _bulk_chat_completion_body(broken_text),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)
    monkeypatch.setattr(openrouter_client, "http_invoke", _fake_http_invoke)

    with pytest.raises(RuntimeError) as exc_info:
        parser.parse_bulk_expense_invoices_from_assets(
            [
                {
                    "id": "asset-fail",
                    "s3_key": "k",
                    "file_name": "bulk.pdf",
                    "content_type": "application/pdf",
                }
            ],
            timeout=25,
        )

    msg = str(exc_info.value)
    assert "even after repair" in msg
    assert "MARKER_TOKEN" in msg


# ---------------------------------------------------------------------------
# Single-invoice parser shape (sync-era one-call shape — see commit b6f8990b)
# ---------------------------------------------------------------------------


def test_parse_invoice_makes_a_single_chat_completion_call(monkeypatch: Any) -> None:
    """``parse_invoice_from_assets`` is one call, no engine chain.

    The earlier engine fallback chain (added in PR #1681 then reverted
    here) layered three engines on top of every single-invoice parse. That
    multiplied the cost / rate-limit footprint of every call and was a
    direct response to empty-response failures caused by JSON mode (see
    ``_openrouter_chat_completion`` docstring). With JSON mode dropped the
    chain is no longer needed; the parser is back to the original one-call
    shape from commit b6f8990b that the user has consistently said worked.
    """
    _set_common_env(monkeypatch)
    _mock_secrets(monkeypatch)
    monkeypatch.setattr(parser, "_RETRY_BACKOFF_SCHEDULE_SECONDS", ())

    class _FakeS3Client:
        def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
            return {"Body": _FakeBody(b"%PDF-1.4")}

    call_log: list[dict[str, Any]] = []

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        call_log.append(kwargs)
        return {
            "status": 200,
            "body": _bulk_chat_completion_body(
                json.dumps(
                    {
                        "vendor_name": "Single Shop",
                        "invoice_number": "S1",
                        "invoice_date": "2026-05-15",
                        "due_date": None,
                        "currency": "USD",
                        "subtotal": 4,
                        "tax": 0,
                        "total": 4,
                        "line_items": [],
                        "confidence": 0.9,
                    }
                )
            ),
        }

    monkeypatch.setattr(parser, "get_s3_client", lambda: _FakeS3Client())
    monkeypatch.setattr(parser, "http_invoke", _fake_http_invoke)

    result = parser.parse_invoice_from_assets(
        [
            {
                "id": "asset-single",
                "s3_key": "k",
                "file_name": "bulk.pdf",
                "content_type": "application/pdf",
            }
        ]
    )

    assert len(call_log) == 1, "single-invoice parser must make exactly one call"
    sent_payload = json.loads(call_log[0]["body"])
    assert "response_format" not in sent_payload, "JSON mode is intentionally off"
    assert sent_payload["plugins"][0]["pdf"]["engine"] == "mistral-ocr"
    assert result["vendor_name"] == "Single Shop"


def test_get_api_key_refetches_after_ttl(monkeypatch: Any) -> None:
    _set_common_env(monkeypatch)
    call_count = {"n": 0}

    class _FakeSecretsClient:
        def get_secret_value(self, SecretId: str) -> dict[str, str]:
            call_count["n"] += 1
            return {
                "SecretString": json.dumps(
                    {"openrouter_api_key": f"key-{call_count['n']}"}
                )
            }

    monkeypatch.setattr(
        parser,
        "get_secretsmanager_client",
        lambda: _FakeSecretsClient(),
    )
    monkeypatch.setattr(parser, "SECRETS_CACHE_TTL_SECONDS", 300)

    times = iter([100.0, 100.0, 500.0])
    monkeypatch.setattr(parser.time, "monotonic", lambda: next(times))

    assert parser._get_api_key() == "key-1"
    assert parser._get_api_key() == "key-1"
    assert parser._get_api_key() == "key-2"
    assert call_count["n"] == 2
