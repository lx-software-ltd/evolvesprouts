"""Stack labels resolve from the plan, including the spaced names."""

from __future__ import annotations

import json
from pathlib import Path

PLAN = (
    Path(__file__).resolve().parents[1] / "backend" / "infrastructure" / "cdk-plan.json"
)


def test_labels_name_stacks_in_the_plan() -> None:
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    known = {
        name
        for group in plan["groups"]
        for name in group["stacks"]
    }
    aliases = plan["aliases"]
    assert aliases["all stacks"] == [
        "evolvesprouts",
        "evolvesprouts-admin-web",
        "evolvesprouts-public-www",
        "evolvesprouts-training",
    ]
    assert aliases["admin web"] == ["evolvesprouts-admin-web"]
    assert aliases["public website"] == ["evolvesprouts-public-www"]
    assert aliases["training web"] == ["evolvesprouts-training"]
    assert all(name in known for names in aliases.values() for name in names)
