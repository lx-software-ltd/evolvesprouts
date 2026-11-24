"""Promotion reads the staging bucket through cfn-stack-outputs."""

from __future__ import annotations

from pathlib import Path

WORKFLOW = (
    Path(__file__).resolve().parents[1]
    / ".github"
    / "workflows"
    / "promote-public-www.yml"
)


def test_promote_does_not_call_describe_stacks() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "describe-stacks" not in text
    assert "cfn-stack-outputs@" in text
    assert "outputs: PublicWwwStagingBucketName" in text
    assert "read_staging=true" in text
    assert "steps.promotion_mode.outputs.read_staging == 'true'" in text
