"""Build a local Lambda bundle for CDK asset staging."""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from collections.abc import Callable

logger = logging.getLogger(__name__)
_DEFAULT_MAX_CACHE_ENTRIES = 3
_PIP_MAX_ATTEMPTS = 3
_PIP_RETRY_BASE_SECONDS = 5
_PIP_TIMEOUT_SECONDS = 120


def _ensure_python_version() -> None:
    if sys.version_info[:2] != (3, 12):
        raise SystemExit("Python 3.12 is required to build Lambda bundles.")


def _run_pip(
    command: list[str],
    cwd: Path,
    env: dict[str, str],
    *,
    max_attempts: int = _PIP_MAX_ATTEMPTS,
    sleep: Callable[[float], None] = time.sleep,
    on_retry: Callable[[], None] | None = None,
) -> None:
    """Install Lambda wheels; retry transient PyPI/read timeouts."""
    last_error: subprocess.CalledProcessError | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            subprocess.run(command, check=True, cwd=cwd, env=env)
            return
        except subprocess.CalledProcessError as exc:
            last_error = exc
            if attempt == max_attempts:
                raise
            if on_retry is not None:
                on_retry()
            delay = _PIP_RETRY_BASE_SECONDS * attempt
            logger.warning(
                "pip install failed (attempt %s/%s, exit %s); retrying in %ss",
                attempt,
                max_attempts,
                exc.returncode,
                delay,
            )
            sleep(delay)
    if last_error is not None:
        raise last_error


def _copy_tree(source: Path, destination: Path) -> None:
    if not source.exists():
        raise FileNotFoundError(f"Missing source path: {source}")
    shutil.copytree(source, destination, dirs_exist_ok=True)


def _cleanup_bundle(output_dir: Path) -> None:
    for cache_dir in output_dir.rglob("__pycache__"):
        shutil.rmtree(cache_dir)
    for cache_file in output_dir.rglob("*.pyc"):
        cache_file.unlink()
    for cache_file in output_dir.rglob("*.pyo"):
        cache_file.unlink()


# Lambda Python 3.12 runs on Amazon Linux 2023 (glibc 2.34), so wheels tagged
# manylinux_2_28 are compatible. Newer projects (for example psycopg-binary
# 3.3.x) raised their manylinux baseline and no longer publish
# manylinux_2_17_aarch64 wheels, so we must request the newer tags. We still
# accept manylinux_2_17_aarch64 as a fallback for older transitive deps that
# only publish that tag. pip will pick the most specific available wheel.
_LAMBDA_PIP_PLATFORMS: tuple[str, ...] = (
    "manylinux_2_28_aarch64",
    "manylinux_2_27_aarch64",
    "manylinux_2_17_aarch64",
)


def _requirements_cache_key(requirements: Path) -> str:
    hasher = hashlib.sha256()
    hasher.update(requirements.read_bytes())
    for platform in _LAMBDA_PIP_PLATFORMS:
        hasher.update(f"\nplatform={platform}".encode())
    hasher.update(b"\nimplementation=cp")
    hasher.update(b"\npython_version=3.12")
    return hasher.hexdigest()


def _prune_dependency_cache(
    *,
    cache_root: Path,
    keep_entries: int,
    active_key: str,
) -> None:
    temp_dirs = [
        path
        for path in cache_root.iterdir()
        if path.is_dir() and path.name.startswith(".tmp-")
    ]
    for temp_dir in temp_dirs:
        shutil.rmtree(temp_dir)

    for cache_dir in cache_root.iterdir():
        if not cache_dir.is_dir() or cache_dir.name.startswith(".tmp-"):
            continue
        marker = cache_root / f"{cache_dir.name}.ready"
        if not marker.is_file():
            shutil.rmtree(cache_dir)

    ready_markers = [path for path in cache_root.glob("*.ready") if path.is_file()]
    cache_entries: list[tuple[str, float]] = []
    for marker in ready_markers:
        cache_key = marker.stem
        cache_dir = cache_root / cache_key
        if not cache_dir.is_dir():
            marker.unlink()
            continue
        cache_entries.append((cache_key, marker.stat().st_mtime))

    cache_entries.sort(key=lambda entry: entry[1], reverse=True)
    for cache_key, _ in cache_entries[keep_entries:]:
        if cache_key == active_key:
            continue
        cache_dir = cache_root / cache_key
        marker = cache_root / f"{cache_key}.ready"
        if cache_dir.is_dir():
            shutil.rmtree(cache_dir)
        if marker.is_file():
            marker.unlink()
        logger.info("Pruned Lambda dependency cache %s", cache_key[:12])


def _build_dependency_cache(
    source_root: Path,
    requirements: Path,
    env: dict[str, str],
    *,
    max_cache_entries: int,
) -> Path:
    cache_root = source_root / ".lambda-build" / "dependency-cache"
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_key = _requirements_cache_key(requirements)
    cache_dir = cache_root / cache_key
    ready_marker = cache_root / f"{cache_key}.ready"

    if cache_dir.is_dir() and ready_marker.is_file():
        logger.info("Reusing Lambda dependency cache %s", cache_key[:12])
        ready_marker.touch()
        _prune_dependency_cache(
            cache_root=cache_root,
            keep_entries=max_cache_entries,
            active_key=cache_key,
        )
        return cache_dir

    logger.info("Building Lambda dependency cache %s", cache_key[:12])
    temp_cache_dir = cache_root / f".tmp-{cache_key}"
    if temp_cache_dir.exists():
        shutil.rmtree(temp_cache_dir)
    temp_cache_dir.mkdir(parents=True, exist_ok=True)

    pip_command: list[str] = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "-r",
        "requirements.txt",
        "-t",
        str(temp_cache_dir),
        "--no-compile",
        "--disable-pip-version-check",
    ]
    # Use Lambda-compatible wheels (Amazon Linux 2023 / manylinux_2_28 baseline,
    # glibc 2.34) on ARM64 (Graviton2) - matches Lambda runtime config.
    for platform in _LAMBDA_PIP_PLATFORMS:
        pip_command.extend(["--platform", platform])
    pip_command.extend(
        [
            "--only-binary=:all:",
            "--implementation",
            "cp",
            "--python-version",
            "3.12",
            "--timeout",
            str(_PIP_TIMEOUT_SECONDS),
            "--retries",
            "10",
        ]
    )

    def _reset_temp_cache() -> None:
        if temp_cache_dir.exists():
            shutil.rmtree(temp_cache_dir)
        temp_cache_dir.mkdir(parents=True, exist_ok=True)

    try:
        _run_pip(
            pip_command,
            cwd=source_root,
            env=env,
            on_retry=_reset_temp_cache,
        )
        _cleanup_bundle(temp_cache_dir)
        if cache_dir.exists():
            shutil.rmtree(cache_dir)
        temp_cache_dir.rename(cache_dir)
        ready_marker.write_text("ready\n", encoding="utf-8")
        _prune_dependency_cache(
            cache_root=cache_root,
            keep_entries=max_cache_entries,
            active_key=cache_key,
        )
        return cache_dir
    finally:
        if temp_cache_dir.exists():
            shutil.rmtree(temp_cache_dir)


def build_bundle(
    source_root: Path,
    output_dir: Path,
    *,
    cache_only: bool = False,
    max_cache_entries: int = _DEFAULT_MAX_CACHE_ENTRIES,
) -> None:
    requirements = source_root / "requirements.txt"
    if not requirements.is_file():
        raise FileNotFoundError(f"Missing requirements file: {requirements}")

    env = os.environ.copy()
    pip_cache_dir = source_root / ".lambda-build" / "pip-cache"
    pip_cache_dir.mkdir(parents=True, exist_ok=True)
    env.update(
        {
            "HOME": "/tmp",
            "PIP_CACHE_DIR": str(pip_cache_dir),
            "PIP_DEFAULT_TIMEOUT": str(_PIP_TIMEOUT_SECONDS),
            "PIP_RETRIES": "10",
            "PYTHONUSERBASE": "/tmp/.local",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONHASHSEED": "0",
        }
    )

    dependency_cache = _build_dependency_cache(
        source_root,
        requirements,
        env,
        max_cache_entries=max_cache_entries,
    )
    if cache_only:
        return

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    _copy_tree(dependency_cache, output_dir)

    _copy_tree(source_root / "lambda", output_dir / "lambda")
    _copy_tree(source_root / "src", output_dir / "src")
    shared_config = source_root.parent / "shared" / "config"
    if shared_config.is_dir():
        _copy_tree(shared_config, output_dir / "shared" / "config")
    _cleanup_bundle(output_dir)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="Path to backend source root.",
    )
    parser.add_argument(
        "--output-dir",
        default="",
        help="Output directory for the bundled assets.",
    )
    parser.add_argument(
        "--cache-only",
        action="store_true",
        help="Build dependency cache only (skip writing final bundle output).",
    )
    parser.add_argument(
        "--max-cache-entries",
        type=int,
        default=_DEFAULT_MAX_CACHE_ENTRIES,
        help=(
            "Keep only the most recent dependency cache entries. "
            f"Default: {_DEFAULT_MAX_CACHE_ENTRIES}."
        ),
    )
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    _ensure_python_version()
    args = _parse_args()
    source_root = Path(args.source_root).resolve()
    output_dir = (
        Path(args.output_dir).resolve()
        if args.output_dir
        else source_root / ".lambda-build" / "base"
    )
    if args.max_cache_entries < 1:
        raise SystemExit("--max-cache-entries must be at least 1.")
    if args.cache_only:
        logger.info("Preparing Lambda dependency cache for %s", source_root)
    else:
        logger.info("Building Lambda bundle in %s", output_dir)
    build_bundle(
        source_root,
        output_dir,
        cache_only=args.cache_only,
        max_cache_entries=args.max_cache_entries,
    )
    if args.cache_only:
        logger.info("Lambda dependency cache ready.")
    else:
        logger.info("Lambda bundle ready.")


if __name__ == "__main__":
    main()
