#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() {
  local message="$1"
  echo "::error title=.cursorrules compliance::${message}"
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "Missing required file: ${path}"
}

require_literal() {
  local path="$1"
  local literal="$2"
  local message="$3"
  if command -v rg >/dev/null 2>&1; then
    rg --fixed-strings --quiet -- "$literal" "$path" || fail "${message} (file: ${path})"
    return
  fi

  # Keep CI portable on runners where ripgrep is unavailable.
  grep --fixed-strings --quiet -- "$literal" "$path" || fail "${message} (file: ${path})"
}

require_file ".cursorrules"
require_file "AGENTS.md"
require_file ".cursor/rules/00_mandatory_cursorrules.mdc"

# Keep checks focused on stable, high-value compliance anchors.
require_literal ".cursorrules" "## Scope and applicability (MANDATORY)" "Missing mandatory scope section"
require_literal ".cursorrules" "## Workflow (MANDATORY)" "Missing mandatory workflow section"
require_literal ".cursorrules" "Wait for explicit user approval." "Missing explicit user approval guardrail"
require_literal ".cursorrules" "Treat all write operations as implementation and blocked before approval." "Missing strict pre-approval write-operation guardrail"
require_literal ".cursorrules" "If implementation scope changes after approval, stop and request renewed" "Missing re-approval-on-scope-change guardrail"
require_literal ".cursorrules" "## Documentation freshness (MANDATORY after code changes)" "Missing documentation freshness section"
require_literal ".cursorrules" "Asset API module layout is mandatory:" "Missing asset API modularity convention"
require_literal ".cursorrules" "### SVG icons (MANDATORY for \`apps/admin_web/**\` and \`apps/public_www/**\`)" "Missing SVG icons convention for web apps"
require_literal ".cursorrules" '### Admin Web OpenAPI typing contract (MANDATORY for `apps/admin_web/**`)' "Missing admin web OpenAPI typing contract"
require_literal ".cursorrules" '### Admin Web CRUD UX pattern (MANDATORY for `apps/admin_web/**`)' "Missing admin web CRUD UX pattern section"
require_literal ".cursorrules" "table-first, expand-in-place" "Missing admin web table-first layout standard"
require_literal ".cursorrules" "**Operations column controls** are rendered by \`AdminRowActions\`" "Missing admin web Operations column control standard"

require_literal "AGENTS.md" 'Read `@.cursorrules` before any analysis, plan, command, or code edit.' "Missing AGENTS bootstrap requirement"
require_literal "AGENTS.md" 'Treat the rules in `.cursorrules` as mandatory for the full session.' "Missing AGENTS mandatory-application requirement"
require_literal "AGENTS.md" "Do not perform implementation actions until explicit user approval is received" "Missing AGENTS strict approval guardrail"
require_literal "AGENTS.md" "## Headless, cloud, and IDE agent runtimes" "Missing AGENTS headless-runtime .cursorrules read requirement"
require_literal "AGENTS.md" "read the file" "Missing AGENTS explicit read-.cursorrules instruction"

require_literal ".cursor/rules/00_mandatory_cursorrules.mdc" "alwaysApply: true" "Cursor always-apply flag is not present"
require_literal ".cursor/rules/00_mandatory_cursorrules.mdc" "Before your **first** repository tool call" "Missing Cursor explicit read-.cursorrules-before-tools requirement"
require_literal ".cursor/rules/00_mandatory_cursorrules.mdc" 'Do not continue with implementation if `.cursorrules` has not been applied.' "Missing Cursor hard-stop requirement"
require_literal ".cursor/rules/00_mandatory_cursorrules.mdc" "Do not perform implementation actions until explicit user approval is" "Missing Cursor strict approval guardrail"

echo ".cursorrules compliance checks passed."
