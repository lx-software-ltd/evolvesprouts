#!/usr/bin/env bash
# Install the dependencies the pre-commit hooks in this repository need.
set -euo pipefail
npm ci --prefix backend/infrastructure
