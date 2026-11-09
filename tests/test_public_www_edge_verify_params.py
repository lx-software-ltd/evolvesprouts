"""Edge-verify parameters must reach CloudFormation even when empty."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-backend.yml"
EDGE_VERIFY_PARAMS = (
    "PublicWwwEdgeVerifySecret",
    "PublicWwwEdgeVerifySecretPrevious",
    "PublicWwwStagingEdgeVerifySecret",
    "PublicWwwStagingEdgeVerifySecretPrevious",
)


def _block(text: str, start_marker: str) -> str:
    start = text.index(start_marker)
    end = text.index("}", start)
    return text[start:end]


def test_empty_edge_verify_parameters_are_forwarded() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    public_params = _block(text, "public_params = {")
    pass_empty = _block(text, "pass_empty_params = {")
    for name in EDGE_VERIFY_PARAMS:
        assert f'"{name}"' in public_params
        assert f'"{name}"' in pass_empty
    for secret in (
        "CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY",
        "CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY_PREVIOUS",
        "CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY",
        "CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY_PREVIOUS",
    ):
        assert f"secrets.{secret}" in text
