"""Guard PostgreSQL UnsafeNewEnumValueUsage in a single Alembic revision."""

from __future__ import annotations

import ast
import importlib.util
import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_VERSIONS = _REPO_ROOT / "backend" / "db" / "alembic" / "versions"

_ADD_VALUE = re.compile(
    r"ALTER TYPE \w+ ADD VALUE(?: IF NOT EXISTS)? '([^']+)'",
    re.IGNORECASE,
)


def _docstring_nodes(tree: ast.AST) -> set[ast.AST]:
    nodes: set[ast.AST] = set()
    for parent in [tree, *ast.walk(tree)]:
        body = getattr(parent, "body", None)
        if not body:
            continue
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            nodes.add(first.value)
    return nodes


def _string_constants(path: Path) -> list[str]:
    text = path.read_text()
    tree = ast.parse(text)
    skip = _docstring_nodes(tree)
    values: list[str] = []
    for node in ast.walk(tree):
        if node in skip:
            continue
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            values.append(node.value)
    return values


def _load_revision(path: Path, name: str) -> object:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_new_enum_labels_are_not_used_in_the_same_revision() -> None:
    """ADD VALUE and INSERT/CHECK of that label must be separate revisions.

    Alembic runs with ``transaction_per_migration=True`` so a later revision
    can use a label added in the previous one. Using it in the same upgrade
    fails on Aurora with ``UnsafeNewEnumValueUsage``.
    """
    violations: list[str] = []
    for path in sorted(_VERSIONS.glob("*.py")):
        literals = _string_constants(path)
        labels = [
            match for literal in literals for match in _ADD_VALUE.findall(literal)
        ]
        if not labels:
            continue
        remainder = [literal for literal in literals if not _ADD_VALUE.search(literal)]
        for label in labels:
            quoted = f"'{label}'"
            if any(quoted in literal for literal in remainder):
                violations.append(f"{path.name}: uses new enum label '{label}'")
    assert not violations, (
        "Split ALTER TYPE ... ADD VALUE into its own revision before using "
        "the label:\n" + "\n".join(violations)
    )


def test_action_recorded_enum_commits_before_open_lead_merge() -> None:
    rev_0085 = _load_revision(
        _VERSIONS / "0085_action_recorded_enum.py",
        "rev_0085_action_recorded_enum",
    )
    rev_0086 = _load_revision(
        _VERSIONS / "0086_one_open_lead_contact.py",
        "rev_0086_one_open_lead_contact",
    )

    assert rev_0085.revision == "0085_action_recorded_enum"
    assert rev_0085.down_revision == "0084_sales_daily_plans"
    assert rev_0086.revision == "0086_one_open_lead_contact"
    assert rev_0086.down_revision == "0085_action_recorded_enum"

    upgrade_sql = "\n".join(
        _string_constants(_VERSIONS / "0085_action_recorded_enum.py")
    )
    assert "ADD VALUE" in upgrade_sql
    assert "ADD VALUE" not in "\n".join(
        _string_constants(_VERSIONS / "0086_one_open_lead_contact.py")
    )
    assert "'action_recorded'" in getattr(rev_0086, "_MERGE_OPEN_DUPLICATES")
