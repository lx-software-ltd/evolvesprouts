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


def test_legacy_protection_forbidden_does_not_abort_ruleset_checks() -> None:
    verifier = _load(
        "verify_github_rulesets", ROOT / "scripts" / "verify_github_rulesets.py"
    )
    assert verifier.legacy_read_is_absent(
        "gh api repos/example/branches/main/protection failed: HTTP 403"
    )
    assert verifier.legacy_read_is_absent("Not Found")
    assert not verifier.legacy_read_is_absent("HTTP 500")
    disabled = {
        "name": "main-protection",
        "target": "branch",
        "enforcement": "disabled",
        "conditions": {"ref_name": {"include": ["refs/heads/main"]}},
        "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}],
    }
    tags = {
        "name": "release-tags",
        "target": "tag",
        "enforcement": "active",
        "conditions": {"ref_name": {"include": ["refs/tags/v*"]}},
        "rules": [{"type": "deletion"}],
    }
    errors = verifier.evaluate(
        rulesets=[disabled, tags], legacy_protection=None, legacy_tags=None
    )
    assert errors == ["No active ruleset targets main."]


def test_pytest_coverage_floor_is_enforced_in_ci() -> None:
    workflow = (ROOT / ".github" / "workflows" / "test.yml").read_text(encoding="utf-8")
    assert "--cov-fail-under=70" in workflow
    pyproject = (ROOT / "backend" / "pyproject.toml").read_text(encoding="utf-8")
    assert "fail_under =" not in pyproject


def test_python_length_ratchet_scans_backend_source_only() -> None:
    checker = _load(
        "check_python_file_length", ROOT / "scripts" / "check_python_file_length.py"
    )
    roots = {path.relative_to(ROOT).as_posix() for path in checker.SCAN_ROOTS}
    assert roots == {"backend/src", "backend/lambda"}


def test_post_edit_reads_documented_hook_paths() -> None:
    hook = _load("post_edit", ROOT / ".cursor" / "hooks" / "post_edit.py")
    from_edit = hook._edited_path({"file_path": "/tmp/example.py"})
    assert from_edit == hook.Path("/tmp/example.py")
    from_write = hook._edited_path(
        {"tool_input": {"path": "apps/admin_web/src/app/page.tsx"}, "cwd": "/workspace"}
    )
    assert from_write == hook.Path("/workspace/apps/admin_web/src/app/page.tsx")


def test_hooks_use_documented_events() -> None:
    hooks = (ROOT / ".cursor" / "hooks.json").read_text(encoding="utf-8")
    assert '"afterFileEdit"' in hooks
    assert '"matcher": "Write"' in hooks
    assert "StrReplace" not in hooks
    assert "guard_shell.sh" in hooks
