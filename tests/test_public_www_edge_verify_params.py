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


def _resolve(stacks: str, extra_env: dict[str, str]) -> list[tuple[str, str, str]]:
    env = {"PATH": os.environ["PATH"], "PARAM_FILE": str(PARAMS), "STACKS": stacks}
    env.update(extra_env)
    completed = subprocess.run(
        [sys.executable, "-c", _workflow_python()],
        check=False,
        capture_output=True,
        env=env,
    )
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
    assert "repository secrets or production-environment secrets" in text


def test_production_json_placeholders_match_the_workflow_secrets() -> None:
    params = json.loads(PARAMS.read_text(encoding="utf-8"))
    assert params["PublicWwwEdgeVerifySecret"] == (
        "<FROM_GITHUB_SECRET: CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY>"
    )
    assert params["PublicWwwStagingEdgeVerifySecret"] == (
        "<FROM_GITHUB_SECRET: CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY>"
    )
