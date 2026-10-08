"""Alembic revision ids stay unique, linked, and within the 32-character contract."""

from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = ROOT / "backend" / "db" / "alembic" / "versions"
REVISION_PATTERN = re.compile(r"^[0-9]{4}_[a-z0-9_]+$")
MAX_LENGTH = 32


def _assigned_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return node.target.id
    if (
        isinstance(node, ast.Assign)
        and len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
    ):
        return node.targets[0].id
    return None


def _literal(node: ast.AnnAssign | ast.Assign) -> object:
    return ast.literal_eval(node.value)


def _revisions() -> dict[str, str | None]:
    found: dict[str, str | None] = {}
    for path in sorted(VERSIONS.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        revision: str | None = None
        down: str | None = None
        saw_down = False
        for node in tree.body:
            name = _assigned_name(node)
            if name == "revision":
                value = _literal(node)
                assert isinstance(value, str), f"{path.name} revision must be a string"
                revision = value
            elif name == "down_revision":
                saw_down = True
                value = _literal(node)
                assert value is None or isinstance(
                    value, str
                ), f"{path.name} down_revision must be a string or None"
                down = value
        assert revision is not None, f"{path.name} is missing revision"
        assert saw_down, f"{path.name} is missing down_revision"
        found[revision] = down
    return found


def test_revision_ids_match_the_contract() -> None:
    revisions = _revisions()
    assert revisions, "expected Alembic revisions"
    for revision in revisions:
        assert len(revision) <= MAX_LENGTH, revision
        assert REVISION_PATTERN.fullmatch(revision), revision


def test_revision_chain_has_one_head() -> None:
    revisions = _revisions()
    parents = set(revisions.values())
    heads = [revision for revision in revisions if revision not in parents]
    roots = [revision for revision, parent in revisions.items() if parent is None]
    assert len(heads) == 1, heads
    assert len(roots) == 1, roots
    missing = [
        parent for parent in parents if parent is not None and parent not in revisions
    ]
    assert missing == []
