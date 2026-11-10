"""Edge-verify parameters must reach CloudFormation even when empty."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-backend.yml"
PARAMS = ROOT / "backend" / "infrastructure" / "params" / "production.json"
PUBLIC_STACK = "evolvesprouts-public-www"
EDGE_VERIFY_PARAMS = (
    "PublicWwwEdgeVerifySecret",
    "PublicWwwEdgeVerifySecretPrevious",
    "PublicWwwStagingEdgeVerifySecret",
    "PublicWwwStagingEdgeVerifySecretPrevious",
)
STAGING_SECRET = "staging-edge-verify-secret-value-0123456789abcd"


def _workflow_python() -> str:
    text = WORKFLOW.read_text(encoding="utf-8")
    marker = text.index("import json\n")
    start = text.rfind("\n", 0, marker) + 1
    lines: list[str] = []
    for line in text[start:].splitlines(keepends=True):
        if line.strip() == "PY":
            break
        lines.append(line)
    return textwrap.dedent("".join(lines))


def _resolve_raw(
    stacks: str, extra_env: dict[str, str]
) -> subprocess.CompletedProcess[bytes]:
    env = {"PATH": os.environ["PATH"], "PARAM_FILE": str(PARAMS), "STACKS": stacks}
    env.update(extra_env)
    return subprocess.run(
        [sys.executable, "-c", _workflow_python()],
        check=False,
        capture_output=True,
        env=env,
    )


def _resolve(stacks: str, extra_env: dict[str, str]) -> list[tuple[str, str, str]]:
    completed = _resolve_raw(stacks, extra_env)
    assert completed.returncode == 0, completed.stderr.decode("utf-8")
    tokens = completed.stdout.split(b"\0")
    resolved: list[tuple[str, str, str]] = []
    index = 0
    while index < len(tokens):
        if tokens[index] == b"":
            index += 1
            continue
        assert tokens[index] == b"--parameters", tokens[index]
        assignment = tokens[index + 1].decode("utf-8")
        stack, value = assignment.split(":", 1)
        key, raw = value.split("=", 1)
        resolved.append((stack, key, raw))
        index += 2
    return resolved


def _public(rows: list[tuple[str, str, str]]) -> dict[str, str]:
    return {key: raw for stack, key, raw in rows if stack == PUBLIC_STACK}


def test_empty_edge_verify_parameters_are_forwarded() -> None:
    resolved = _public(_resolve(PUBLIC_STACK, {}))
    for name in EDGE_VERIFY_PARAMS:
        assert resolved[name] == ""
    assert resolved["WafWebAclArn"] == ""
    assert "PublicWwwApiBaseUrl" not in resolved
    assert "LoginLinkBaseUrl" not in resolved


def test_a_set_staging_secret_is_forwarded_and_production_stays_empty() -> None:
    resolved = _public(
        _resolve(
            PUBLIC_STACK,
            {"CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY": STAGING_SECRET},
        )
    )
    assert resolved["PublicWwwStagingEdgeVerifySecret"] == STAGING_SECRET
    assert resolved["PublicWwwEdgeVerifySecret"] == ""
    assert resolved["PublicWwwStagingEdgeVerifySecretPrevious"] == ""


def test_edge_verify_parameters_stay_off_the_backend_stack() -> None:
    rows = _resolve("evolvesprouts", {})
    assert rows
    assert all(key not in EDGE_VERIFY_PARAMS for _stack, key, _raw in rows)
    assert ("evolvesprouts", "PublicWwwDomainName", "www.evolvesprouts.com") in rows


def test_edge_verify_secrets_are_read_from_the_production_environment_job() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    job = text.split("jobs:", 1)[1]
    assert "environment: production" in job
    for secret in (
        "CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY",
        "CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY_PREVIOUS",
        "CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY",
        "CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY_PREVIOUS",
    ):
        assert f"{secret}: ${{{{ secrets.{secret} }}}}" in text
    assert "report_public_www_edge_verify.sh" in job
    assert "PublicWwwStagingEdgeVerifyEnabled" in job
    assert "PublicWwwEdgeVerifyEnabled" in job


def _report(
    tmp_path: Path, args: list[str]
) -> tuple[subprocess.CompletedProcess[str], str]:
    summary = tmp_path / "summary.md"
    completed = subprocess.run(
        ["bash", str(ROOT / "scripts/deploy/report_public_www_edge_verify.sh"), *args],
        check=False,
        capture_output=True,
        text=True,
        env={"PATH": os.environ["PATH"], "GITHUB_STEP_SUMMARY": str(summary)},
    )
    written = summary.read_text(encoding="utf-8") if summary.exists() else ""
    return completed, written


def test_turning_the_staging_lock_off_warns(tmp_path: Path) -> None:
    completed, summary = _report(tmp_path, ["true", "false", "false", "false"])
    assert completed.returncode == 0, completed.stderr
    assert "::warning title=Staging origin lock turned off::" in completed.stdout
    assert "true -> false" in completed.stdout
    assert "PublicWwwStagingEdgeVerifyEnabled" in summary
    assert "turned off" in summary


def test_leaving_the_staging_lock_on_does_not_warn(tmp_path: Path) -> None:
    completed, summary = _report(tmp_path, ["true", "true", "false", "false"])
    assert completed.returncode == 0, completed.stderr
    assert "::warning" not in completed.stdout
    assert "turned off" not in summary
    assert "| `PublicWwwStagingEdgeVerifyEnabled` | true | true |" in summary


def test_turning_the_production_lock_off_warns(tmp_path: Path) -> None:
    completed, summary = _report(tmp_path, ["true", "true", "true", "false"])
    assert completed.returncode == 0, completed.stderr
    assert "::warning title=Production origin lock turned off::" in completed.stdout
    assert "::warning title=Staging origin lock turned off::" not in completed.stdout
    assert "the production origin lock turned off" in summary


def test_turning_the_staging_lock_on_does_not_warn(tmp_path: Path) -> None:
    completed, summary = _report(tmp_path, ["absent", "true", "absent", "false"])
    assert completed.returncode == 0, completed.stderr
    assert "::warning" not in completed.stdout
    assert "absent" in summary


def test_report_requires_four_values() -> None:
    completed = subprocess.run(
        ["bash", str(ROOT / "scripts/deploy/report_public_www_edge_verify.sh")],
        check=False,
        capture_output=True,
        text=True,
        env={"PATH": os.environ["PATH"]},
    )
    assert completed.returncode == 2
    assert "usage:" in completed.stderr


def test_non_iana_timezone_fails_parameter_resolution() -> None:
    for env_name, param in (
        ("CDK_PARAM_INVOICE_DISPLAY_TIMEZONE", "InvoiceDisplayTimezone"),
        ("CDK_PARAM_EVENTBRITE_DEFAULT_TIMEZONE", "EventbriteDefaultTimezone"),
        ("CDK_PARAM_SALES_RECAP_DISPLAY_TIMEZONE", "SalesRecapDisplayTimezone"),
    ):
        completed = _resolve_raw("evolvesprouts", {env_name: "HKT"})
        assert completed.returncode != 0
        assert param.encode() in completed.stderr
        assert b"HKT" in completed.stderr


def test_valid_iana_timezones_are_forwarded() -> None:
    rows = _resolve(
        "evolvesprouts",
        {
            "CDK_PARAM_INVOICE_DISPLAY_TIMEZONE": "Asia/Hong_Kong",
            "CDK_PARAM_EVENTBRITE_DEFAULT_TIMEZONE": "Asia/Hong_Kong",
            "CDK_PARAM_SALES_RECAP_DISPLAY_TIMEZONE": "UTC",
        },
    )
    assert ("evolvesprouts", "InvoiceDisplayTimezone", "Asia/Hong_Kong") in rows
    assert ("evolvesprouts", "EventbriteDefaultTimezone", "Asia/Hong_Kong") in rows
    assert ("evolvesprouts", "SalesRecapDisplayTimezone", "UTC") in rows


def test_empty_timezones_stay_omitted() -> None:
    keys = {key for _stack, key, _raw in _resolve("evolvesprouts", {})}
    assert "InvoiceDisplayTimezone" not in keys
    assert "EventbriteDefaultTimezone" not in keys
    assert "SalesRecapDisplayTimezone" not in keys


def test_certificate_founder_name_is_forwarded_from_the_repository_variable() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert (
        "CDK_PARAM_CERTIFICATE_ES_FOUNDER_NAME: ${{ vars.CDK_PARAM_CERTIFICATE_ES_FOUNDER_NAME }}"
        in text
    )
    rows = _resolve(
        "evolvesprouts",
        {"CDK_PARAM_CERTIFICATE_ES_FOUNDER_NAME": "Ada Example"},
    )
    assert (
        "evolvesprouts",
        "PublicWwwCertificateEsFounderName",
        "Ada Example",
    ) in rows


def test_backend_deploy_does_not_read_apple_signing_inputs() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "APPLE_TEAM_ID" not in text
    assert "CDK_PARAM_APPLE_PRIVATE_KEY" not in text


def test_inbound_sender_patterns_come_from_the_secret() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert (
        "CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS: ${{ secrets.CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS }}"
        in text
    )
    assert "vars.CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS" not in text
    params = json.loads(PARAMS.read_text(encoding="utf-8"))
    assert params["InboundInvoiceAllowedSenderPatterns"] == (
        "<FROM_GITHUB_SECRET: CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS>"
    )
    rows = _resolve(
        "evolvesprouts",
        {"CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS": "billing@example.com"},
    )
    assert (
        "evolvesprouts",
        "InboundInvoiceAllowedSenderPatterns",
        "billing@example.com",
    ) in rows


def test_production_json_placeholders_match_the_workflow_secrets() -> None:
    params = json.loads(PARAMS.read_text(encoding="utf-8"))
    assert params["PublicWwwEdgeVerifySecret"] == (
        "<FROM_GITHUB_SECRET: CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY>"
    )
    assert params["PublicWwwStagingEdgeVerifySecret"] == (
        "<FROM_GITHUB_SECRET: CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY>"
    )
