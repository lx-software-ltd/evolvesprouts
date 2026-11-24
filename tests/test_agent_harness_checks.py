"""Local harness checks stay green and the shell hook blocks destructive commands."""

from __future__ import annotations

import importlib.util
import io
import json
import subprocess
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
    result = subprocess.run(
        ["node", "scripts/check-lambda-docs.mjs"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_pytest_coverage_floor_is_enforced_in_ci() -> None:
    workflow = (ROOT / ".github" / "workflows" / "test.yml").read_text(encoding="utf-8")
    script = (ROOT / "scripts" / "ci" / "test-python.sh").read_text(encoding="utf-8")
    assert "bash scripts/ci/test-python.sh" in workflow
    assert "--cov-fail-under=70" in script
    pyproject = (ROOT / "backend" / "pyproject.toml").read_text(encoding="utf-8")
    assert "fail_under =" not in pyproject


def test_python_length_ratchet_scans_backend_source_only() -> None:
    config = json.loads((ROOT / ".github" / "harness.json").read_text(encoding="utf-8"))
    assert config["file-length"]["scan-roots"] == ["backend/src", "backend/lambda"]


class _Completed:
    def __init__(self, stdout: str, returncode: int = 0) -> None:
        self.stdout = stdout
        self.stderr = ""
        self.returncode = returncode


def test_stop_gate_missing_pre_commit_is_one_followup(monkeypatch) -> None:
    stop = _load("stop_gate", ROOT / ".cursor" / "hooks" / "stop_gate.py")

    def fake_run(command, **kwargs):
        if command[0] == "git":
            return _Completed(" M file.py\n")
        if command[0] == "node":
            return _Completed("")
        raise FileNotFoundError(command[0])

    monkeypatch.setattr(stop.subprocess, "run", fake_run)
    stdin = io.StringIO(json.dumps({"status": "completed"}))
    monkeypatch.setattr(stop.sys, "stdin", stdin)
    output = io.StringIO()
    monkeypatch.setattr(stop.sys, "stdout", output)
    assert stop.main() == 0
    message = json.loads(output.getvalue())["followup_message"]
    assert message.count("pre-commit is not on PATH") == 1
    assert "lx-software-ltd/actions" in message
    assert "network" in message
    assert "clone" in message


def test_stop_gate_rule_failure_is_not_rewritten_as_a_missing_binary(
    monkeypatch,
) -> None:
    stop = _load("stop_gate", ROOT / ".cursor" / "hooks" / "stop_gate.py")

    def fake_run(command, **kwargs):
        if command[0] == "git":
            return _Completed(" M file.py\n")
        if command[:4] == ["pre-commit", "run", "validate-agent-rules", "--all-files"]:
            return _Completed("rule bullet is missing [why:]", 1)
        return _Completed("")

    monkeypatch.setattr(stop.subprocess, "run", fake_run)
    stdin = io.StringIO(json.dumps({"status": "completed"}))
    monkeypatch.setattr(stop.sys, "stdin", stdin)
    output = io.StringIO()
    monkeypatch.setattr(stop.sys, "stdout", output)
    assert stop.main() == 0
    message = json.loads(output.getvalue())["followup_message"]
    assert "pre-commit is not on PATH" not in message
    assert "rule bullet is missing [why:]" in message


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
