#!/usr/bin/env python3
"""Check that agent rules stay short, scoped, and traceable."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULES_DIR = ROOT / ".cursor" / "rules"
SKILLS_DIR = ROOT / ".cursor" / "skills"
AGENTS_LIMIT = 150
RULE_LIMIT = 200
SKILL_LIMIT = 220
POINTER_LIMIT = 12

REQUIRED_RULES = {
    "00-repository-core.mdc": True,
    "backend-api.mdc": False,
    "infrastructure-cdk.mdc": False,
    "admin-web.mdc": False,
    "public-www.mdc": False,
    "training-web.mdc": False,
    "flutter-app.mdc": False,
}
REQUIRED_SKILLS = (
    "db-migration",
    "admin-api-endpoint",
    "admin-crud-screen",
    "public-www-section",
    "verify-change",
)
FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)


def _lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()


def _front_matter(text: str) -> dict[str, str]:
    match = FRONT_MATTER.match(text)
    if not match:
        raise ValueError("missing front matter")
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if not line.strip() or line.startswith(" "):
            continue
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    return fields


def _body(text: str) -> str:
    match = FRONT_MATTER.match(text)
    if not match:
        return text
    return text[match.end() :]


def validate() -> list[str]:
    errors: list[str] = []
    agents = ROOT / "AGENTS.md"
    pointer = ROOT / ".cursorrules"
    if not agents.exists():
        errors.append("Missing AGENTS.md")
    else:
        count = len(_lines(agents))
        if count > AGENTS_LIMIT:
            errors.append(f"AGENTS.md is {count} lines; limit is {AGENTS_LIMIT}")
        text = agents.read_text(encoding="utf-8")
        for required in ("## Zones", "docs/architecture/zones.md", "## Cursor Cloud"):
            if required not in text:
                errors.append(f"AGENTS.md is missing {required}")
    if not pointer.exists():
        errors.append("Missing .cursorrules pointer")
    else:
        count = len(_lines(pointer))
        text = pointer.read_text(encoding="utf-8")
        if count > POINTER_LIMIT:
            errors.append(
                f".cursorrules is {count} lines; keep it a pointer of at most {POINTER_LIMIT}"
            )
        if "AGENTS.md" not in text or ".cursor/rules/" not in text:
            errors.append(".cursorrules must point at AGENTS.md and .cursor/rules/")
    if not (ROOT / "docs" / "architecture" / "zones.md").exists():
        errors.append("Missing docs/architecture/zones.md")
    if not (ROOT / ".github" / "PULL_REQUEST_TEMPLATE.md").exists():
        errors.append("Missing .github/PULL_REQUEST_TEMPLATE.md")
    if not (ROOT / ".cursor" / "hooks.json").exists():
        errors.append("Missing .cursor/hooks.json")

    found_rules = (
        {path.name: path for path in RULES_DIR.glob("*.mdc")}
        if RULES_DIR.exists()
        else {}
    )
    for name, always in REQUIRED_RULES.items():
        path = found_rules.get(name)
        if path is None:
            errors.append(f"Missing rule {name}")
            continue
        text = path.read_text(encoding="utf-8")
        count = len(_lines(path))
        if count > RULE_LIMIT:
            errors.append(f"{name} is {count} lines; limit is {RULE_LIMIT}")
        try:
            fields = _front_matter(text)
        except ValueError as exc:
            errors.append(f"{name}: {exc}")
            continue
        expected = "true" if always else "false"
        if fields.get("alwaysApply") != expected:
            errors.append(f"{name} alwaysApply must be {expected}")
        if not always and not fields.get("globs"):
            errors.append(f"{name} must set globs")
        if always and fields.get("globs"):
            errors.append(f"{name} is always applied and must not set globs")
        for line_number, line in enumerate(_body(text).splitlines(), start=1):
            if line.startswith("- ") and "[why:" not in line:
                errors.append(f"{name}:{line_number} rule bullet is missing [why:]")
    for name, path in sorted(found_rules.items()):
        if name not in REQUIRED_RULES:
            text = path.read_text(encoding="utf-8")
            try:
                fields = _front_matter(text)
            except ValueError as exc:
                errors.append(f"{name}: {exc}")
                continue
            if fields.get("alwaysApply") == "true":
                errors.append(
                    f"Only 00-repository-core.mdc may set alwaysApply: true ({name})"
                )

    for skill in REQUIRED_SKILLS:
        path = SKILLS_DIR / skill / "SKILL.md"
        if not path.exists():
            errors.append(f"Missing skill {skill}")
            continue
        text = path.read_text(encoding="utf-8")
        count = len(_lines(path))
        if count > SKILL_LIMIT:
            errors.append(f"{skill}/SKILL.md is {count} lines; limit is {SKILL_LIMIT}")
        try:
            fields = _front_matter(text)
        except ValueError as exc:
            errors.append(f"{skill}: {exc}")
            continue
        if fields.get("name") != skill:
            errors.append(f"{skill} front matter name must be {skill}")
        if not fields.get("description"):
            errors.append(f"{skill} is missing a description")
    return errors


def main() -> int:
    errors = validate()
    if errors:
        print("Agent rules check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Agent rules check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
