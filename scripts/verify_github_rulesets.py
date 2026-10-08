#!/usr/bin/env python3
"""Fail when main or release-tag protection is missing or weaker than the documented ruleset."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any

MAIN_INCLUDES = {"refs/heads/main", "main", "~DEFAULT_BRANCH", "~ALL"}


def _includes(ruleset: dict[str, Any]) -> list[str]:
    conditions = ruleset.get("conditions") or {}
    ref_name = conditions.get("ref_name") or {}
    include = ref_name.get("include") or []
    return [str(item) for item in include]


def targets_main(ruleset: dict[str, Any]) -> bool:
    if ruleset.get("target") != "branch":
        return False
    if ruleset.get("enforcement") != "active":
        return False
    return any(item in MAIN_INCLUDES for item in _includes(ruleset))


def targets_release_tags(ruleset: dict[str, Any]) -> bool:
    if ruleset.get("target") != "tag":
        return False
    if ruleset.get("enforcement") != "active":
        return False
    includes = _includes(ruleset)
    return any(
        item in {"refs/tags/v*", "refs/tags/v", "~ALL"}
        or item.startswith("refs/tags/v")
        for item in includes
    )


def _rules(rulesets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    for ruleset in rulesets:
        rules = ruleset.get("rules") or []
        collected.extend(rule for rule in rules if isinstance(rule, dict))
    return collected


def _status_contexts(rules: list[dict[str, Any]]) -> list[str]:
    contexts: list[str] = []
    for rule in rules:
        if rule.get("type") != "required_status_checks":
            continue
        parameters = rule.get("parameters") or {}
        for check in parameters.get("required_status_checks") or []:
            if isinstance(check, dict):
                context = str(check.get("context") or "")
            else:
                context = str(check)
            if context:
                contexts.append(context)
    return contexts


def _has_context(contexts: list[str], needle: str) -> bool:
    needle_lower = needle.lower()
    return any(needle_lower in context.lower() for context in contexts)


def evaluate_branch_rulesets(rulesets: list[dict[str, Any]]) -> list[str]:
    active = [ruleset for ruleset in rulesets if targets_main(ruleset)]
    if not active:
        return ["No active ruleset targets main."]
    errors: list[str] = []
    rules = _rules(active)
    review_counts = [
        int((rule.get("parameters") or {}).get("required_approving_review_count") or 0)
        for rule in rules
        if rule.get("type") == "pull_request"
    ]
    if not review_counts or max(review_counts) < 1:
        errors.append("main ruleset does not require at least 1 approving review.")
    contexts = _status_contexts(rules)
    if not _has_context(contexts, "lint"):
        errors.append(
            "main ruleset does not require a status check whose name contains 'lint'."
        )
    if not _has_context(contexts, "test"):
        errors.append(
            "main ruleset does not require a status check whose name contains 'test'."
        )
    rule_types = {str(rule.get("type")) for rule in rules}
    if "deletion" not in rule_types:
        errors.append("main ruleset does not block deletions.")
    if "non_fast_forward" not in rule_types:
        errors.append("main ruleset does not block force pushes.")
    return errors


def evaluate_legacy_protection(protection: dict[str, Any] | None) -> list[str]:
    if not protection:
        return ["No branch protection configured for main."]
    errors: list[str] = []
    reviews = protection.get("required_pull_request_reviews") or {}
    if int(reviews.get("required_approving_review_count") or 0) < 1:
        errors.append(
            "Legacy main protection does not require at least 1 approving review."
        )
    contexts = (protection.get("required_status_checks") or {}).get("contexts") or []
    context_text = [str(item) for item in contexts]
    if not _has_context(context_text, "lint"):
        errors.append(
            "Legacy main protection does not require a status check whose name contains 'lint'."
        )
    if not _has_context(context_text, "test"):
        errors.append(
            "Legacy main protection does not require a status check whose name contains 'test'."
        )
    if (protection.get("allow_force_pushes") or {}).get("enabled") is True:
        errors.append("Legacy main protection allows force pushes.")
    if (protection.get("allow_deletions") or {}).get("enabled") is True:
        errors.append("Legacy main protection allows deletions.")
    return errors


def evaluate_tag_protection(
    rulesets: list[dict[str, Any]], legacy_tags: list[Any] | None
) -> list[str]:
    if any(targets_release_tags(ruleset) for ruleset in rulesets):
        return []
    if legacy_tags:
        return []
    return ["No active ruleset protects v* tags."]


def evaluate(
    *,
    rulesets: list[dict[str, Any]],
    legacy_protection: dict[str, Any] | None,
    legacy_tags: list[Any] | None,
) -> list[str]:
    branch_errors = evaluate_branch_rulesets(rulesets)
    if (
        branch_errors == ["No active ruleset targets main."]
        and legacy_protection is not None
    ):
        branch_errors = evaluate_legacy_protection(legacy_protection)
    return branch_errors + evaluate_tag_protection(rulesets, legacy_tags)


def legacy_read_is_absent(detail: str) -> bool:
    """Classic protection endpoints 404 when unset and 403 without admin rights.

    A 403 must not abort verification before the rulesets API is evaluated.
    """
    text = detail.lower()
    return (
        "404" in text
        or "not found" in text
        or "403" in text
        or "resource not accessible" in text
    )


def _gh_json(path: str) -> Any:
    result = subprocess.run(
        ["gh", "api", path],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"gh api {path} failed: {detail}")
    if not result.stdout.strip():
        return None
    return json.loads(result.stdout)


def load_live(
    repo: str,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[Any] | None]:
    summaries = _gh_json(f"repos/{repo}/rulesets") or []
    rulesets: list[dict[str, Any]] = []
    for summary in summaries:
        ruleset_id = summary.get("id")
        if ruleset_id is None:
            continue
        detail = _gh_json(f"repos/{repo}/rulesets/{ruleset_id}")
        if isinstance(detail, dict):
            rulesets.append(detail)
    legacy_protection: dict[str, Any] | None
    try:
        protection = _gh_json(f"repos/{repo}/branches/main/protection")
        legacy_protection = protection if isinstance(protection, dict) else None
    except RuntimeError as exc:
        if legacy_read_is_absent(str(exc)):
            legacy_protection = None
        else:
            raise
    legacy_tags: list[Any] | None
    try:
        tags = _gh_json(f"repos/{repo}/tags/protection")
        legacy_tags = tags if isinstance(tags, list) and tags else None
    except RuntimeError as exc:
        if legacy_read_is_absent(str(exc)):
            legacy_tags = None
        else:
            raise
    return rulesets, legacy_protection, legacy_tags


def main() -> int:
    repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if not repo:
        print("GITHUB_REPOSITORY is required.", file=sys.stderr)
        return 1
    try:
        rulesets, legacy_protection, legacy_tags = load_live(repo)
    except RuntimeError as exc:
        print(
            f"Ruleset verification could not read GitHub protection: {exc}",
            file=sys.stderr,
        )
        return 1
    errors = evaluate(
        rulesets=rulesets, legacy_protection=legacy_protection, legacy_tags=legacy_tags
    )
    if errors:
        print("GitHub ruleset verification failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("GitHub ruleset verification passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
