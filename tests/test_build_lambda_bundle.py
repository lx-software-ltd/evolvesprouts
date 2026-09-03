"""Unit tests for Lambda bundle pip retries."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
from typing import Any

import pytest


def _load_bundle_module() -> Any:
    module_path = (
        Path(__file__).resolve().parents[1]
        / "backend"
        / "scripts"
        / "build_lambda_bundle.py"
    )
    spec = importlib.util.spec_from_file_location(
        "test_build_lambda_bundle_module",
        module_path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module at {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_run_pip_retries_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = _load_bundle_module()
    calls = {"n": 0}
    sleeps: list[float] = []
    resets = {"n": 0}

    def fake_run(*_args: Any, **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        calls["n"] += 1
        if calls["n"] < 3:
            raise subprocess.CalledProcessError(2, ["pip", "install"])
        return subprocess.CompletedProcess(["pip", "install"], 0)

    monkeypatch.setattr(bundle.subprocess, "run", fake_run)

    bundle._run_pip(
        ["pip", "install"],
        cwd=Path("/tmp"),
        env={},
        sleep=sleeps.append,
        on_retry=lambda: resets.__setitem__("n", resets["n"] + 1),
    )

    assert calls["n"] == 3
    assert sleeps == [5, 10]
    assert resets["n"] == 2


def test_run_pip_raises_after_all_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = _load_bundle_module()

    def fake_run(*_args: Any, **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        raise subprocess.CalledProcessError(2, ["pip", "install"])

    monkeypatch.setattr(bundle.subprocess, "run", fake_run)

    with pytest.raises(subprocess.CalledProcessError):
        bundle._run_pip(
            ["pip", "install"],
            cwd=Path("/tmp"),
            env={},
            max_attempts=2,
            sleep=lambda _delay: None,
        )
