"""Repository for customer (AR) invoices."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql import ColumnElement

from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.enums import BillingInvoiceStatus
from app.db.repositories.base import BaseRepository

INVOICE_SETTLEMENT_FILTERS = (
    "open",
    "partially_paid",
    "paid",
    "no_charge",
    "not_completed",
)


def _ilike_pattern(raw: str) -> tuple[str, str]:
    """LIKE pattern plus escape char so ``%`` / ``_`` in user input stay literal."""
    esc = "\\"
    escaped = (
        raw.replace(esc, esc + esc).replace("%", esc + "%").replace("_", esc + "_")
    )
    return f"%{escaped}%", esc


def _settlement_clause(settlement: str) -> ColumnElement[bool] | None:
    issued = CustomerInvoice.status == BillingInvoiceStatus.ISSUED
    if settlement == "open":
        return and_(issued, CustomerInvoice.balance_due > 0)
    if settlement == "partially_paid":
        return and_(
            issued,
            CustomerInvoice.amount_allocated > 0,
            CustomerInvoice.balance_due > 0,
        )
    if settlement == "paid":
        return and_(
            issued,
            CustomerInvoice.balance_due == 0,
            CustomerInvoice.amount_allocated > 0,
            CustomerInvoice.total > 0,
        )
    if settlement == "no_charge":
        return and_(issued, CustomerInvoice.total == 0)
    if settlement == "not_completed":
        # Draft invoices are incomplete; issued with positive total excluding paid slice.
        return or_(
            CustomerInvoice.status == BillingInvoiceStatus.DRAFT,
            and_(
                issued,
                CustomerInvoice.total > 0,
                ~and_(
                    CustomerInvoice.balance_due == 0,
                    CustomerInvoice.amount_allocated > 0,
                ),
            ),
        )
    return None


class CustomerInvoiceRepository(BaseRepository[CustomerInvoice]):
    """Data access for ``customer_invoices`` and their lines."""

    def __init__(self, session: Session):
        super().__init__(session, CustomerInvoice)

    def get_with_lines(self, invoice_id: UUID) -> CustomerInvoice | None:
        statement = (
            select(CustomerInvoice)
            .where(CustomerInvoice.id == invoice_id)
            .options(selectinload(CustomerInvoice.lines))
        )
        return self._session.execute(statement).scalar_one_or_none()

    def list_newest(
        self,
        *,
        limit: int,
        cursor_created_at: datetime | None = None,
        cursor_id: UUID | None = None,
        party_clause: ColumnElement[bool] | None = None,
        status: BillingInvoiceStatus | None = None,
        settlement: str | None = None,
        currency: str | None = None,
        search: str | None = None,
    ) -> list[CustomerInvoice]:
        """Invoices newest first; callers over-fetch by one to detect another page."""
        statement = select(CustomerInvoice)
        if party_clause is not None:
            statement = statement.where(party_clause)
        if status is not None:
            statement = statement.where(CustomerInvoice.status == status)
        if settlement is not None:
            clause = _settlement_clause(settlement)
            if clause is not None:
                statement = statement.where(clause)
        if currency is not None:
            statement = statement.where(CustomerInvoice.currency == currency)
        if search:
            pattern, esc = _ilike_pattern(search)
            invoice_date_iso = func.to_char(CustomerInvoice.invoice_date, "YYYY-MM-DD")
            statement = statement.where(
                or_(
                    CustomerInvoice.invoice_number.ilike(pattern, escape=esc),
                    CustomerInvoice.bill_to_display_name.ilike(pattern, escape=esc),
                    CustomerInvoice.bill_to_email.ilike(pattern, escape=esc),
                    CustomerInvoice.bill_to_location_text.ilike(pattern, escape=esc),
                    invoice_date_iso.ilike(pattern, escape=esc),
                )
            )
        if cursor_created_at is not None and cursor_id is not None:
            statement = statement.where(
                or_(
                    CustomerInvoice.created_at < cursor_created_at,
                    and_(
                        CustomerInvoice.created_at == cursor_created_at,
                        CustomerInvoice.id < cursor_id,
                    ),
                )
            )
        statement = statement.order_by(
            CustomerInvoice.created_at.desc(), CustomerInvoice.id.desc()
        ).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    def number_and_created_at_by_id(
        self, invoice_ids: list[UUID]
    ) -> dict[UUID, tuple[str | None, datetime | None]]:
        rows = self._session.execute(
            select(
                CustomerInvoice.id,
                CustomerInvoice.invoice_number,
                CustomerInvoice.created_at,
            ).where(CustomerInvoice.id.in_(invoice_ids))
        ).all()
        return {row[0]: (row[1], row[2]) for row in rows}

    def line_counts_by_invoice_id(self, invoice_ids: list[UUID]) -> dict[UUID, int]:
        if not invoice_ids:
            return {}
        rows = self._session.execute(
            select(CustomerInvoiceLine.invoice_id, func.count(CustomerInvoiceLine.id))
            .where(CustomerInvoiceLine.invoice_id.in_(invoice_ids))
            .group_by(CustomerInvoiceLine.invoice_id)
        ).all()
        return {row[0]: int(row[1]) for row in rows}
