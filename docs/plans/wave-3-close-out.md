# Plan: Wave 3 close-out

**Status**: Draft
**Zone**: yellow

## Goal

Close CI convergence wave 3 for `evolvesprouts` on pin `61b67ed4f686659433f6ca4cb10c80707e365cd0` (`# main 2026-11-22`). The `workflow-conformance` job lands in `warn`. The last commit of this branch sets `mode` to `enforce`.

## Non-goals

Pair B. Amplify and Flutter stay. The lint and test gates keep their push path filters. There is no `changes` job and no `allow-skipped` input to remove. No deploy, bootstrap, or key-management workflow is triggered. Dependabot `cooldown.exclude` is not added. Checkout `ref:` expressions are not edited.

## Files

`.github/workflows/`, `.pre-commit-config.yaml`, `.cursor/hooks/stop_gate.py`, `.cursor/rules/00-repository-core.mdc`, `.cursor/skills/verify-change/SKILL.md`, `docs/architecture/zones.md`, `scripts/pii-denylist.sha256` (kept), and the deleted local hook scripts.

## Invariants this change preserves

- One `lx-software-ltd/actions` commit: `61b67ed4f686659433f6ca4cb10c80707e365cd0`. The pre-commit `rev` is that same commit.
- `lint` and `test` stay the required check names. Their `if: always()` gates still call `require-jobs`.
- CodeQL still analyzes `python` and `javascript-typescript` and still uploads `category: "/language:${{ matrix.language }}"`, with `config-file: .github/codeql/codeql-config.yml`.
- Semgrep uploads `category: ".github/workflows/security.yml:semgrep"`.
- Checkout steps that already set `ref: ${{ github.event.pull_request.head.sha || github.sha }}` are unchanged. That expression checks out the pull request head on purpose (C09).
- Expressions that read `AWS_ACCOUNT_ID`, secrets, or vars are unchanged.
- The PII denylist file stays at `scripts/pii-denylist.sha256`. No plaintext was added.
- `subosito/flutter-action` stays at `1a449444c387b1966244ae4d4f8c696479add0b2` `# v2.23.0`.

## Done when

- `CONFORMANCE_MODE=enforce CONFORMANCE_PROFILE=product python3 /workspace/workflow-conformance/check_workflows.py`, run from this repository, reports no findings. The same command passed before the warn job was added.
- Runners are `ubuntu-26.04` or `macos-26`. Node `node-version` values that were `lts/*` or `22.22.2` are `"26"`, including deploy workflows.
- Images end in `@sha256:` and 64 hex digits: Semgrep `f83a64e8a7d985eaa51ee3978c9c882be946964c68633fba5d2817cf297a3912` and Postgres `72d22ce26d04fe56a5384e9f6b026152d1cf05db602a7a3524a3ed337d5f5752`.
- Semgrep `mode: scan` reads the whole repository. The previous command was `semgrep ci`, which scans files changed since the base. The packs in that job were `p/python`, `p/security-audit`, `p/secrets`, and `p/owasp-top-ten`. The added pack is `p/javascript`. The five packs are `p/python p/javascript p/security-audit p/secrets p/owasp-top-ten`. `upload` is `"false"`, and the separate upload step keeps the old category.
- Bandit 1.9.4 on `backend/src` and `backend/lambda` on 22 Nov 2026 reports no high findings and no B105 or B106 findings. Two medium B310 `urlopen` calls remain: `cfn_response.py` allows only HTTPS hosts ending in `.amazonaws.com`, and `aws_proxy.py` allows only `http` and `https` URLs on the proxy allow-list. The directory skip stays `B310`. No `# nosec` lines were added.
- `npm-audit` uses `audit-level: high` for `apps/admin_web`, `apps/public_www`, `apps/training`, and `backend/infrastructure`.
- `pip-audit` still audits `backend/requirements.txt` and still ignores `PYSEC-2025-183`.
- Flutter `3.50.1` is the stable SDK from the Set up Flutter step. Successful run `44916864555`, job `136884245510` (Check Flutter lockfiles), commit `58ab636`, 2026-11-21, invoked `setup.sh` with `-n '3.50.1'`. Lint Dart job `136884245791` in run `44916864554` restored the same `stable-3.50.1-x64` cache. That version is passed to `flutter-lockfiles` and to the existing `subosito/flutter-action` steps in lint, test, and the deploy workflows.
- Every Dependabot ecosystem block already had `cooldown.default-days: 7`. No block was missing it, and `cooldown.exclude` was not added.
- G2 is approved. Pre-commit uses `https://github.com/lx-software-ltd/actions` at the pin above for `check-pii`, `validate-agent-rules`, `check-file-length`, and `check-test-focus`. The local script copies and `tests/test_check_pii.py` are deleted. `HARNESS_SECTION=file-length` and `HARNESS_SECTION=test-focus` both pass on this tree. The stop hook catches `FileNotFoundError` and returns one follow-up when `pre-commit` is not on `PATH`: the hooks live in `lx-software-ltd/actions`, and the first run needs network to clone that repository. A real rule failure is not rewritten as that sentence. The core rule keeps `[why: 2fbc06dd hashed PII denylist]`.
- `python3 -m pytest tests/test_agent_harness_checks.py` passes (8 tests). `node scripts/check-lambda-docs.mjs` passes.
- This branch is not merged and no pull request is opened from this work.

## Rollback

Revert this branch. The previous actions pin is `aab84b76383d5a44838f9617ac47b23cfff7fdaf`.

## Open questions

None. CodeQL categories stay `/language:${{ matrix.language }}`, so existing alerts stay attached to `python` and `javascript-typescript`.
