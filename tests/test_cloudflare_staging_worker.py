"""Staging allow-list Worker upload metadata."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "cloudflare" / "staging_worker.py"
)


def _module():
    spec = importlib.util.spec_from_file_location("staging_worker", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_private_and_duplicate_addresses_are_dropped() -> None:
    ips = _module().parse_allowed_ips("8.8.8.8, 10.0.0.5\n2001:db8::1 8.8.8.8 1.1.1.1")

    assert ips == ["8.8.8.8", "1.1.1.1"]


def test_only_private_addresses_is_an_error() -> None:
    module = _module()
    with pytest.raises(module.WorkerError, match="no public addresses"):
        module.parse_allowed_ips("10.0.0.5, 192.168.1.1")


def test_invalid_address_is_rejected() -> None:
    module = _module()
    with pytest.raises(module.WorkerError, match="not an IP address"):
        module.parse_allowed_ips("8.8.8.8, staging.example")


def test_cli_dry_run_does_not_print_secret_names_or_values(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    module = _module()
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "account")
    monkeypatch.setenv("STAGING_ALLOWED_IPS", "8.8.8.8")
    monkeypatch.setenv("STAGING_BYPASS_SECRET", "bypass-value-must-stay-off-stdout")

    assert (
        module.main(
            [
                "--name",
                "example-worker",
                "--zone",
                "example.com",
                "--route",
                "staging.example.com/*",
                "--production-origin",
                "https://example.com",
            ]
        )
        == 0
    )
    printed = capsys.readouterr().out
    assert "bypass-value-must-stay-off-stdout" not in printed
    assert "STAGING_BYPASS_SECRET" not in printed
    assert "worker example-worker: 1 allowed IPs" in printed


def test_metadata_keeps_existing_secrets_when_unset() -> None:
    metadata = _module().build_metadata("https://prod.example", ["8.8.8.8"], {})

    assert metadata["keep_bindings"] == ["secret_text"]
    assert {b["name"]: b["type"] for b in metadata["bindings"]} == {
        "PRODUCTION_ORIGIN": "plain_text",
        "STAGING_ALLOWED_IPS": "plain_text",
    }


def test_metadata_sets_provided_secrets() -> None:
    metadata = _module().build_metadata(
        "https://prod.example",
        ["8.8.8.8", "1.1.1.1"],
        {
            "STAGING_BYPASS_SECRET": "bypass",
            "PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET": " ",
        },
    )

    by_name = {b["name"]: b for b in metadata["bindings"]}
    assert by_name["STAGING_ALLOWED_IPS"]["text"] == "8.8.8.8,1.1.1.1"
    assert by_name["STAGING_BYPASS_SECRET"] == {
        "type": "secret_text",
        "name": "STAGING_BYPASS_SECRET",
        "text": "bypass",
    }
    assert "PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET" not in by_name


@pytest.mark.parametrize(
    "origin", ["http://prod.example", "https://prod.example/en", "prod.example"]
)
def test_production_origin_must_be_bare_https(origin: str) -> None:
    module = _module()
    with pytest.raises(module.WorkerError, match="production-origin"):
        module.build_metadata(origin, ["8.8.8.8"], {})
