#!/usr/bin/env bash
set -euo pipefail
python3 -m pip install -q 'mypy==1.8.0'
# mypy pending: mypy 1.8.0 does not pass these directories.
# backend/src crashes on its module layout.
# backend/lambda/auth: duplicate module named "handler"
# backend/lambda/authorizers: duplicate module named "handler"
# backend/lambda/eventbrite_sync_processor: 8 errors
# backend/lambda/expense_parser: 8 errors
# backend/lambda/imports: 8 errors
# backend/lambda/media_processor: 8 errors
# backend/lambda/migrations: 10 errors
dirs=(
  backend/lambda/admin
  backend/lambda/admin_bootstrap
  backend/lambda/api_key_rotation
  backend/lambda/aws_proxy
  backend/lambda/bulk_expense_import
  backend/lambda/health
  backend/lambda/inbound_invoice_email
  backend/lambda/inbox_import
  backend/lambda/lead_ai_suggestion
  backend/lambda/meta_graph_sync_scheduler
  backend/lambda/sales_daily_plan
  backend/lambda/sales_daily_plan_scheduler
  backend/lambda/ses_template_manager
)
for dir in "${dirs[@]}"; do
  echo "mypy $dir"
  (
    cd "$dir"
    python3 -m mypy --ignore-missing-imports .
  )
done
