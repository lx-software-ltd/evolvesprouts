#!/bin/sh
# beforeShellExecution is fail-closed. If python3 is missing, allow the
# command instead of denying every shell call. A crash after python3 starts
# still exits non-zero, and the hook then denies the command.
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' '{"permission":"allow","agent_message":"Shell guard skipped because python3 is not installed."}'
  exit 0
fi
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd) || exit 1
exec python3 "$ROOT/.cursor/hooks/guard_shell.py"
