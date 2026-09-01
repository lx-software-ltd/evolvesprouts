"""Singleton sales configuration (default assignee and assignment email)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base

SALES_SETTINGS_SINGLETON_ID = 1


class SalesSettings(Base):
    """Single-row sales settings used when creating and assigning leads."""

    __tablename__ = "sales_settings"
    __table_args__ = (
        CheckConstraint(
            f"id = {SALES_SETTINGS_SINGLETON_ID}",
            name="sales_settings_singleton_chk",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    default_assigned_to: Mapped[str | None] = mapped_column(String(128), nullable=True)
    notify_assignee_on_assignment: Mapped[bool] = mapped_column(
        Boolean(),
        nullable=False,
        server_default=text("false"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=func.now(),
    )
    updated_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
