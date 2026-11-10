"""Backend deploy parameter resolution for timezones, certificates, and secrets."""

from __future__ import annotations

import json
import re

from tests.helpers.deploy_backend_params import (
    BACKEND_STACK,
    PARAMS,
    WORKFLOW,
    resolve,
    resolve_raw,
)

_ENV_ASSIGNMENT = re.compile(r"^([A-Z][A-Z0-9_]*)\s*:\s*\$\{\{\s*(.+?)\s*\}\}\s*$")
_GITHUB_REF = re.compile(r"\b(vars|secrets)\.([A-Z0-9_]+)")
_OTHER_STACKS = (
    "evolvesprouts-public-www",
    "evolvesprouts-admin-web",
    "evolvesprouts-training",
)


def _deploy_step_env() -> dict[str, str]:
    """Map Deploy stacks env names to the expression inside ${{ }}."""
    deploy = WORKFLOW.read_text(encoding="utf-8").split("name: Deploy stacks", 1)[1]
    env_block = deploy.split("\n        env:\n", 1)[1]
    found: dict[str, str] = {}
    for line in env_block.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not line.startswith("          "):
            break
        match = _ENV_ASSIGNMENT.match(stripped)
        if match is None:
            continue
        found[match.group(1)] = match.group(2)
    return found


def test_non_iana_timezone_fails_parameter_resolution() -> None:
    for env_name, param in (
        ("CDK_PARAM_INVOICE_DISPLAY_TIMEZONE", "InvoiceDisplayTimezone"),
        ("CDK_PARAM_EVENTBRITE_DEFAULT_TIMEZONE", "EventbriteDefaultTimezone"),
        ("CDK_PARAM_SALES_RECAP_DISPLAY_TIMEZONE", "SalesRecapDisplayTimezone"),
    ):
        completed = resolve_raw(BACKEND_STACK, {env_name: "HKT"})
        assert completed.returncode != 0
        assert param.encode() in completed.stderr
        assert b"HKT" in completed.stderr


def test_valid_iana_timezones_are_forwarded() -> None:
    rows = resolve(
        BACKEND_STACK,
        {
            "CDK_PARAM_INVOICE_DISPLAY_TIMEZONE": "Asia/Hong_Kong",
            "CDK_PARAM_EVENTBRITE_DEFAULT_TIMEZONE": "Asia/Hong_Kong",
            "CDK_PARAM_SALES_RECAP_DISPLAY_TIMEZONE": "UTC",
        },
    )
    assert (BACKEND_STACK, "InvoiceDisplayTimezone", "Asia/Hong_Kong") in rows
    assert (BACKEND_STACK, "EventbriteDefaultTimezone", "Asia/Hong_Kong") in rows
    assert (BACKEND_STACK, "SalesRecapDisplayTimezone", "UTC") in rows


def test_empty_timezones_stay_omitted() -> None:
    keys = {key for _stack, key, _raw in resolve(BACKEND_STACK, {})}
    assert "InvoiceDisplayTimezone" not in keys
    assert "EventbriteDefaultTimezone" not in keys
    assert "SalesRecapDisplayTimezone" not in keys


def test_bad_timezone_does_not_block_stacks_that_omit_it() -> None:
    for stacks in _OTHER_STACKS:
        completed = resolve_raw(stacks, {"CDK_PARAM_INVOICE_DISPLAY_TIMEZONE": "HKT"})
        assert completed.returncode == 0, completed.stderr.decode("utf-8")
        assert b"InvoiceDisplayTimezone" not in completed.stdout


def test_bad_timezone_fails_when_the_backend_stack_is_selected() -> None:
    completed = resolve_raw(
        f"{BACKEND_STACK} evolvesprouts-public-www",
        {"CDK_PARAM_INVOICE_DISPLAY_TIMEZONE": "HKT"},
    )
    assert completed.returncode != 0
    assert b"InvoiceDisplayTimezone" in completed.stderr


def test_eventbrite_timezone_rejects_ids_the_app_would_ignore() -> None:
    for value in ("Etc/GMT-8", "GMT"):
        completed = resolve_raw(
            BACKEND_STACK, {"CDK_PARAM_EVENTBRITE_DEFAULT_TIMEZONE": value}
        )
        assert completed.returncode != 0, value
        assert b"Region/City" in completed.stderr
        assert value.encode() in completed.stderr


def test_invoice_and_sales_recap_accept_iana_ids_eventbrite_rejects() -> None:
    rows = resolve(
        BACKEND_STACK,
        {
            "CDK_PARAM_INVOICE_DISPLAY_TIMEZONE": "Etc/GMT-8",
            "CDK_PARAM_SALES_RECAP_DISPLAY_TIMEZONE": "GMT",
        },
    )
    assert (BACKEND_STACK, "InvoiceDisplayTimezone", "Etc/GMT-8") in rows
    assert (BACKEND_STACK, "SalesRecapDisplayTimezone", "GMT") in rows


def test_certificate_founder_name_comes_from_the_repository_variable() -> None:
    expression = _deploy_step_env()["CDK_PARAM_CERTIFICATE_ES_FOUNDER_NAME"]
    assert _GITHUB_REF.findall(expression) == [
        ("vars", "CDK_PARAM_CERTIFICATE_ES_FOUNDER_NAME")
    ]
    rows = resolve(
        BACKEND_STACK,
        {"CDK_PARAM_CERTIFICATE_ES_FOUNDER_NAME": "Ada Example"},
    )
    assert (
        BACKEND_STACK,
        "PublicWwwCertificateEsFounderName",
        "Ada Example",
    ) in rows


def test_backend_deploy_does_not_read_apple_signing_inputs() -> None:
    env = _deploy_step_env()
    assert "APPLE_TEAM_ID" not in env
    assert "CDK_PARAM_APPLE_PRIVATE_KEY" not in env


def test_inbound_sender_patterns_come_from_the_secret() -> None:
    expression = _deploy_step_env()["CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS"]
    assert _GITHUB_REF.findall(expression) == [
        ("secrets", "CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS")
    ]
    params = json.loads(PARAMS.read_text(encoding="utf-8"))
    assert params["InboundInvoiceAllowedSenderPatterns"] == (
        "<FROM_GITHUB_SECRET: CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS>"
    )
    rows = resolve(
        BACKEND_STACK,
        {"CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS": "billing@example.com"},
    )
    assert (
        BACKEND_STACK,
        "InboundInvoiceAllowedSenderPatterns",
        "billing@example.com",
    ) in rows
