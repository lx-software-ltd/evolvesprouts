#!/usr/bin/env python3
"""Block destructive shell commands before Cursor runs them."""

from __future__ import annotations

import json
import re
import sys

FORCE_PUSH = re.compile(r"(^|\s)--force(\s|$)|(^|\s)-f(\s|$)")
GIT_PUSH = re.compile(r"\bgit\s+push\b", re.IGNORECASE)
GIT_RESET_HARD = re.compile(r"\bgit\s+reset\b[^\n]*--hard\b", re.IGNORECASE)
RM_RF = re.compile(
    r"\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*[fF]|-[a-zA-Z]*[fF][a-zA-Z]*[rR])\b"
)
SQL_DESTRUCTIVE = re.compile(
    r"\b(drop\s+table|drop\s+schema|truncate\s+table)\b", re.IGNORECASE
)
CDK_DEPLOY = re.compile(r"\bcdk\s+deploy\b")
AWS_DELETE = re.compile(r"\baws\b[^\n]*\sdelete-[a-z0-9-]+")
AMEND = re.compile(r"\bgit\s+commit\b[^\n]*(--amend\b|(^|\s)-[^ \n]*amend)")
ALEMBIC_DOWN = re.compile(r"\balembic\s+downgrade\b", re.IGNORECASE)


def _push_targets_main(command: str) -> bool:
    if not GIT_PUSH.search(command):
        return False
    for token in command.split():
        destination = token.split(":")[-1]
        if destination in {"main", "refs/heads/main"} and (
            token == "main" or ":" in token or token == "refs/heads/main"
        ):
            return True
    return False


def _rm_outside_tmp(command: str) -> bool:
    match = RM_RF.search(command)
    if not match:
        return False
    remainder = command[match.end() :].strip()
    if not remainder:
        return True
    paths = [part for part in remainder.split() if not part.startswith("-")]
    if not paths:
        return True
    return any(
        not (
            part.startswith("/tmp/")
            or part == "/tmp"
            or part.startswith("/var/tmp/")
            or part == "/var/tmp"
        )
        for part in paths
    )


def decide(command: str) -> tuple[str, str]:
    """Return (permission, agent_message). permission is allow, deny, or ask."""
    if (
        GIT_PUSH.search(command)
        and "--force-with-lease" not in command
        and FORCE_PUSH.search(command)
    ):
        return (
            "deny",
            "Force-push is blocked. Push a normal fast-forward or open a pull request.",
        )
    if _push_targets_main(command):
        return "deny", "Pushing to main is blocked. Open a pull request instead."
    if GIT_RESET_HARD.search(command):
        return "deny", "git reset --hard is blocked."
    if _rm_outside_tmp(command):
        return "deny", "rm -rf outside /tmp is blocked."
    if SQL_DESTRUCTIVE.search(command):
        return "deny", "Destructive SQL (DROP TABLE, DROP SCHEMA, TRUNCATE) is blocked."
    if CDK_DEPLOY.search(command):
        return (
            "deny",
            "cdk deploy is blocked in the agent shell. Use the deployment workflow.",
        )
    if AWS_DELETE.search(command):
        return "deny", "aws delete-* commands are blocked in the agent shell."
    if AMEND.search(command):
        return (
            "ask",
            "git commit --amend rewrites history. Confirm this is the commit you just created and have not pushed.",
        )
    if ALEMBIC_DOWN.search(command):
        return (
            "ask",
            "alembic downgrade rewinds schema. Confirm the target revision and the database.",
        )
    return "allow", ""


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        print(
            json.dumps(
                {
                    "permission": "deny",
                    "agent_message": "Shell hook received invalid JSON.",
                }
            )
        )
        return 0
    command = str(payload.get("command") or "")
    permission, message = decide(command)
    result: dict[str, str] = {"permission": permission}
    if message:
        result["agent_message"] = message
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
