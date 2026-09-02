"""Repository for customer payments, allocations, and receipts."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import Session

from app.db.models.customer_payment import CustomerPayment
from app.db.models.customer_receipt import CustomerReceipt
from app.db.models.enrollment import Enrollment
from app.db.models.enums import BillingPaymentDirection, EnrollmentStatus
from app.db.models.payment_allocation import PaymentAllocation
from app.db.repositories.base import BaseRepository


class CustomerPaymentRepository(BaseRepository[CustomerPayment]):
    """Data access for ``customer_payments`` rows and their linkage tables."""

    def __init__(self, session: Session):
        super().__init__(session, CustomerPayment)

    def list_newest(
        self,
        *,
        limit: int,
        cursor_created_at: datetime | None = None,
        cursor_id: UUID | None = None,
        invoice_id: UUID | None = None,
    ) -> list[CustomerPayment]:
        """Payments newest first, optionally only those allocated to one invoice."""
        statement = select(CustomerPayment)
        if invoice_id is not None:
            allocated = (
                select(PaymentAllocation.payment_id)
                .where(PaymentAllocation.invoice_id == invoice_id)
                .distinct()
                .subquery()
            )
            statement = statement.join(
                allocated, CustomerPayment.id == allocated.c.payment_id
            )
        if cursor_created_at is not None and cursor_id is not None:
            statement = statement.where(
                or_(
                    CustomerPayment.created_at < cursor_created_at,
                    and_(
                        CustomerPayment.created_at == cursor_created_at,
                        CustomerPayment.id < cursor_id,
                    ),
                )
            )
        statement = statement.order_by(
            CustomerPayment.created_at.desc(), CustomerPayment.id.desc()
        ).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    def allocated_invoice_ids(self, payment_id: UUID) -> list[UUID]:
        """Distinct invoices this payment has allocations against."""
        return list(
            self._session.execute(
                select(PaymentAllocation.invoice_id)
                .where(PaymentAllocation.payment_id == payment_id)
                .distinct()
            )
            .scalars()
            .all()
        )

    def payment_ids_with_allocations(self, payment_ids: list[UUID]) -> set[UUID]:
        rows = self._session.execute(
            select(PaymentAllocation.payment_id).where(
                PaymentAllocation.payment_id.in_(payment_ids)
            )
        ).all()
        return {row[0] for row in rows}

    def payment_ids_with_receipts(self, payment_ids: list[UUID]) -> set[UUID]:
        rows = self._session.execute(
            select(CustomerReceipt.customer_payment_id).where(
                CustomerReceipt.customer_payment_id.in_(payment_ids)
            )
        ).all()
        return {row[0] for row in rows}

    def refunded_payment_ids(self, payment_ids: list[UUID]) -> set[UUID]:
        """Ids in ``payment_ids`` that have at least one linked refund row."""
        rows = self._session.execute(
            select(CustomerPayment.original_payment_id).where(
                CustomerPayment.original_payment_id.in_(payment_ids),
                CustomerPayment.direction == BillingPaymentDirection.REFUND,
            )
        ).all()
        return {row[0] for row in rows if row[0] is not None}

    def enrollment_status_by_id(
        self, enrollment_ids: list[UUID]
    ) -> dict[UUID, EnrollmentStatus]:
        if not enrollment_ids:
            return {}
        rows = self._session.execute(
            select(Enrollment.id, Enrollment.status).where(
                Enrollment.id.in_(enrollment_ids)
            )
        )
        return {row[0]: row[1] for row in rows}

    def get_receipt(self, payment_id: UUID) -> CustomerReceipt | None:
        return self._session.execute(
            select(CustomerReceipt).where(
                CustomerReceipt.customer_payment_id == payment_id
            )
        ).scalar_one_or_none()

    def has_allocations(self, payment_id: UUID) -> bool:
        return bool(
            self._session.execute(
                select(exists().where(PaymentAllocation.payment_id == payment_id))
            ).scalar_one()
        )

    def has_receipt(self, payment_id: UUID) -> bool:
        return bool(
            self._session.execute(
                select(
                    exists().where(CustomerReceipt.customer_payment_id == payment_id)
                )
            ).scalar_one()
        )

    def has_refunds(self, payment_id: UUID) -> bool:
        return bool(
            self._session.execute(
                select(
                    exists().where(
                        CustomerPayment.original_payment_id == payment_id,
                        CustomerPayment.direction == BillingPaymentDirection.REFUND,
                    )
                )
            ).scalar_one()
        )
