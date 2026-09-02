"""Shared helpers for admin billing unit tests."""

from __future__ import annotations

from typing import Any

import pytest

from app.api import admin_billing_allocations as admin_billing_allocations_mod
from app.api import (
    admin_billing_enrollment_queries as admin_billing_enrollment_queries_mod,
)
from app.api import admin_billing_export as admin_billing_export_mod
from app.api import admin_billing_invoice_drafts as admin_billing_invoice_drafts_mod
from app.api import admin_billing_invoice_queries as admin_billing_invoice_queries_mod
from app.api import admin_billing_invoices as admin_billing_invoices_mod
from app.api import admin_billing_payment_create as admin_billing_payment_create_mod
from app.api import admin_billing_payment_update as admin_billing_payment_update_mod
from app.api import admin_billing_payments as admin_billing_payments_mod


def patch_billing_sessions(monkeypatch: pytest.MonkeyPatch, fake_session: Any) -> None:
    for mod in (
        admin_billing_payments_mod,
        admin_billing_payment_create_mod,
        admin_billing_payment_update_mod,
        admin_billing_invoice_queries_mod,
        admin_billing_invoices_mod,
        admin_billing_invoice_drafts_mod,
        admin_billing_allocations_mod,
        admin_billing_export_mod,
        admin_billing_enrollment_queries_mod,
    ):
        monkeypatch.setattr(mod, "session_with_audit", fake_session)
