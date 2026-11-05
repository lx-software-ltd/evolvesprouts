"""Landing-page JSON is copied into the Lambda bundle."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "backend"
    / "scripts"
    / "build_lambda_bundle.py"
)


def _copy_landing_pages():
    spec = importlib.util.spec_from_file_location("build_lambda_bundle", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load build_lambda_bundle.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.copy_landing_pages


def test_copy_landing_pages_copies_json_only(tmp_path: Path) -> None:
    copy_landing_pages = _copy_landing_pages()
    source = tmp_path / "backend"
    pages = tmp_path / "apps" / "public_www" / "src" / "content" / "landing-pages"
    pages.mkdir(parents=True)
    (pages / "sample.json").write_text("{}", encoding="utf-8")
    (pages / "notes.txt").write_text("nope", encoding="utf-8")
    output = tmp_path / "out"
    output.mkdir()

    copy_landing_pages(source, output)

    copied = output / "content" / "landing-pages"
    assert (copied / "sample.json").read_text(encoding="utf-8") == "{}"
    assert not (copied / "notes.txt").exists()


def test_copy_landing_pages_requires_the_directory(tmp_path: Path) -> None:
    copy_landing_pages = _copy_landing_pages()
    output = tmp_path / "out"
    output.mkdir()

    with pytest.raises(FileNotFoundError):
        copy_landing_pages(tmp_path / "backend", output)
