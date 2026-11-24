#!/usr/bin/env bash
set -euo pipefail
export DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/backend_test"
export TEST_DATABASE_URL="$DATABASE_URL"
python -m pip install --upgrade pip
if [ -f backend/pyproject.toml ]; then
  python -m pip install -e "backend[test]"
elif [ -f backend/requirements.txt ]; then
  python -m pip install -r backend/requirements.txt
  python -m pip install pytest
else
  echo "Missing backend dependency manifest"
  exit 1
fi
python -m alembic -c backend/db/alembic.ini upgrade head
python -m pytest tests backend --cov=app --cov-report=term-missing --cov-report=xml:coverage.xml --cov-fail-under=70
