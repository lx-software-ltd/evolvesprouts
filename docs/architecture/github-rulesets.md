# GitHub Rulesets Configuration

This document describes the recommended GitHub rulesets for repository protection.

## Overview

GitHub rulesets protect critical branches and tags from accidental or malicious
changes. These rules enforce code review, CI checks, and prevent destructive
operations.

---

## Branch Protection: `main`

The `main` branch requires protection as it triggers production deployments.

### Required Rules

| Rule | Setting | Purpose |
|------|---------|---------|
| Require pull request before merging | ✅ Enabled | Prevents direct pushes |
| Required approvals | 0 | Exactly 0 approving reviews |
| Dismiss stale reviews | ✅ Enabled | Re-review after changes |
| Require status checks to pass | ✅ Enabled | CI must pass |
| Require branches to be up to date | ✅ Enabled | Prevents stale merges |
| Block force pushes | ✅ Enabled | Protects history |
| Block deletions | ✅ Enabled | Prevents accidental deletion |

### Required Status Checks

These workflows must pass before merging to `main`:

| Check | Workflow | Purpose |
|-------|----------|---------|
| `lint` | `.github/workflows/lint.yml` | Code style, linting, and agent-rule validation |
| `test` | `.github/workflows/test.yml` | Unit and integration tests |
| `security-summary` | `.github/workflows/security.yml` | Every security job in that workflow |

---

## Tag Protection: `v*`

Release tags should be protected from modification or deletion.

| Rule | Setting | Purpose |
|------|---------|---------|
| Protect tags matching `v*` | ✅ Enabled | Protects release versions |
| Block update and deletion | `release-tags` | A `v*` tag cannot be moved or deleted |
| Block creation | `release-tags-create` | Creation is blocked. Organization admin can bypass |

---

## Setup Instructions

### Option 1: GitHub Web UI

#### Branch Protection

1. Go to repository **Settings** → **Rules** → **Rulesets**
2. Click **New ruleset** → **New branch ruleset**
3. Configure:
   - **Ruleset name:** `main-protection`
   - **Enforcement status:** Active
   - **Target branches:** Add target → Include by pattern → `main`
4. Enable rules:
   - ✅ Restrict deletions
   - ✅ Require a pull request before merging
     - Required approvals: `0`
     - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ Require status checks to pass
     - ✅ Require branches to be up to date before merging
     - Add checks: `lint`, `test`, `security-summary`
   - ✅ Block force pushes
5. Click **Create**

#### Tag Protection

1. Go to repository **Settings** → **Rules** → **Rulesets**
2. Click **New ruleset** → **New tag ruleset**
3. Configure:
   - **Ruleset name:** `release-tags`
   - **Enforcement status:** Active
   - **Target tags:** Add target → Include by pattern → `v*`
4. Enable rules:
   - ✅ Restrict deletions
   - ✅ Restrict updates
5. Click **Create**
6. Create a second tag ruleset, `release-tags-create`, on the same `v*` pattern, and enable **Restrict creations**. Organization admin is the bypass actor.

### Option 2: GitHub CLI

```bash
# Branch protection for main
gh api repos/{owner}/{repo}/rulesets \
  --method POST \
  --field name='main-protection' \
  --field target='branch' \
  --field enforcement='active' \
  --field 'conditions[ref_name][include][]=refs/heads/main' \
  --field 'rules[][type]=deletion' \
  --field 'rules[][type]=non_fast_forward' \
  --field 'rules[][type]=pull_request' \
  --field 'rules[2][parameters][required_approving_review_count]=0' \
  --field 'rules[2][parameters][dismiss_stale_reviews_on_push]=true' \
  --field 'rules[][type]=required_status_checks' \
  --field 'rules[3][parameters][strict_required_status_checks_policy]=true' \
  --field 'rules[3][parameters][required_status_checks][][context]=lint' \
  --field 'rules[3][parameters][required_status_checks][][context]=test' \
  --field 'rules[3][parameters][required_status_checks][][context]=security-summary'

# Tag protection for releases. Update and deletion are one ruleset.
# Creation is a second ruleset so organization admin can bypass creation only.
gh api repos/{owner}/{repo}/rulesets \
  --method POST \
  --field name='release-tags' \
  --field target='tag' \
  --field enforcement='active' \
  --field 'conditions[ref_name][include][]=refs/tags/v*' \
  --field 'rules[][type]=deletion' \
  --field 'rules[][type]=update'

gh api repos/{owner}/{repo}/rulesets \
  --method POST \
  --field name='release-tags-create' \
  --field target='tag' \
  --field enforcement='active' \
  --field 'conditions[ref_name][include][]=refs/tags/v*' \
  --field 'rules[][type]=creation'
```

---

## Verification

A CI workflow (`.github/workflows/verify-rulesets.yml`) runs weekly and on
demand to verify that branch protection rules are correctly configured.

The workflow grants `contents: read` only. `administration` is not a valid
Actions permission, and classic branch-protection reads return 403 for that
token. The weekly job calls the pinned verify-rulesets action and does not
run a local script. A disabled ruleset does not count as protection, so the
job fails until `main-protection` is Active and meets the checks below.

The verification checks fail the job when any of these are missing:
- An active ruleset targets `main`
- An approving-review count of exactly 0
- Required status checks are exactly `lint`, `test`, and `security-summary`
- Force pushes and deletions are blocked
- Active rulesets on `v*` tags block creation, update, and deletion together

The `lint` workflow runs the shared agent harness. If required rule files
are removed or grow past their budget, the lint status fails and merge is
blocked by branch protection.

---

## Exceptions

### Dependabot

Dependabot PRs are automatically created and can be merged after CI passes.
No special exceptions needed as Dependabot respects branch protection.

### Emergency Fixes

In emergencies, repository admins can bypass branch protection. This should
be documented in the PR and followed by a post-mortem if used.

---

## Related Documentation

- [GitHub Rulesets Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
