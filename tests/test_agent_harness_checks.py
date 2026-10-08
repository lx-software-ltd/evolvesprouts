"""Local harness checks stay green and the shell hook blocks destructive commands."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_shell_guard_blocks_destructive_commands() -> None:
    guard = _load("guard_shell", ROOT / ".cursor" / "hooks" / "guard_shell.py")
    assert guard.decide("git status")[0] == "allow"
    assert (
        guard.decide("git push -u origin cursor/agent-harness-ratchet-4f2f")[0]
        == "allow"
    )
    assert (
        guard.decide("git push --force-with-lease origin cursor/feature")[0] == "allow"
    )
    assert guard.decide("rm -rf /tmp/build")[0] == "allow"
    assert guard.decide("git push --force origin feature")[0] == "deny"
    assert guard.decide("git push origin main")[0] == "deny"
    assert guard.decide("git push origin HEAD:main")[0] == "deny"
    assert guard.decide("git reset --hard HEAD")[0] == "deny"
    assert guard.decide("rm -rf apps/admin_web")[0] == "deny"
    assert guard.decide("psql -c 'DROP TABLE contacts'")[0] == "deny"
    assert guard.decide("npx cdk deploy EvolveStack")[0] == "deny"
    assert guard.decide("aws s3api delete-bucket --bucket example")[0] == "deny"
    assert guard.decide("git commit --amend --no-edit")[0] == "ask"
    assert guard.decide("alembic downgrade -1")[0] == "ask"


def test_harness_scripts_pass() -> None:
    commands = (
        [sys.executable, "scripts/check_python_file_length.py"],
        [sys.executable, "scripts/check_test_focus.py"],
        ["node", "scripts/check-lambda-docs.mjs"],
        [sys.executable, "scripts/validate_agent_rules.py"],
    )
    for command in commands:
        result = subprocess.run(
            command, cwd=ROOT, check=False, capture_output=True, text=True
        )
        assert result.returncode == 0, result.stderr or result.stdout


def test_ruleset_evaluator_rejects_a_weak_main_ruleset() -> None:
    verifier = _load(
        "verify_github_rulesets", ROOT / "scripts" / "verify_github_rulesets.py"
    )
    strong = {
        "name": "main-protection",
        "target": "branch",
        "enforcement": "active",
        "conditions": {"ref_name": {"include": ["refs/heads/main"]}},
        "rules": [
            {
                "type": "pull_request",
                "parameters": {"required_approving_review_count": 1},
            },
            {
                "type": "required_status_checks",
                "parameters": {
                    "required_status_checks": [{"context": "lint"}, {"context": "test"}]
                },
            },
            {"type": "deletion"},
            {"type": "non_fast_forward"},
        ],
    }
    tags = {
        "name": "release-tags",
        "target": "tag",
        "enforcement": "active",
        "conditions": {"ref_name": {"include": ["refs/tags/v*"]}},
        "rules": [{"type": "deletion"}, {"type": "update"}],
    }
    assert (
        verifier.evaluate(
            rulesets=[strong, tags], legacy_protection=None, legacy_tags=None
        )
        == []
    )
    weak = {
        **strong,
        "rules": [
            {
                "type": "pull_request",
                "parameters": {"required_approving_review_count": 0},
            }
        ],
    }
    errors = verifier.evaluate(
        rulesets=[weak, tags], legacy_protection=None, legacy_tags=None
    )
    assert any("approving review" in error for error in errors)
    assert verifier.evaluate(rulesets=[], legacy_protection=None, legacy_tags=None)
