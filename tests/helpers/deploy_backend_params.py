"""Run the parameter resolver embedded in deploy-backend.yml."""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-backend.yml"
PARAMS = ROOT / "backend" / "infrastructure" / "params" / "production.json"
BACKEND_STACK = "evolvesprouts"


def workflow_python() -> str:
    text = WORKFLOW.read_text(encoding="utf-8")
    marker = text.index("import json\n")
    start = text.rfind("\n", 0, marker) + 1
    lines: list[str] = []
    for line in text[start:].splitlines(keepends=True):
        if line.strip() == "PY":
            break
        lines.append(line)
    return textwrap.dedent("".join(lines))


def resolve_raw(
    stacks: str, extra_env: dict[str, str]
) -> subprocess.CompletedProcess[bytes]:
    env = {"PATH": os.environ["PATH"], "PARAM_FILE": str(PARAMS), "STACKS": stacks}
    env.update(extra_env)
    return subprocess.run(
        [sys.executable, "-c", workflow_python()],
        check=False,
        capture_output=True,
        env=env,
    )


def resolve(stacks: str, extra_env: dict[str, str]) -> list[tuple[str, str, str]]:
    completed = resolve_raw(stacks, extra_env)
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
