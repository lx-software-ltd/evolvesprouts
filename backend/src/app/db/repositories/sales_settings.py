"""Repository for the singleton sales settings row."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models.sales_settings import SALES_SETTINGS_SINGLETON_ID, SalesSettings


class SalesSettingsRepository:
    """Load or update the single ``sales_settings`` row."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_or_create(self) -> SalesSettings:
        """Return the singleton row, inserting defaults when missing."""
        row = self._session.get(SalesSettings, SALES_SETTINGS_SINGLETON_ID)
        if row is None:
            row = SalesSettings(
                id=SALES_SETTINGS_SINGLETON_ID,
                default_assigned_to=None,
                notify_assignee_on_assignment=False,
            )
            self._session.add(row)
            self._session.flush()
        return row

    def update(self, row: SalesSettings) -> SalesSettings:
        """Persist changes to the singleton row."""
        self._session.add(row)
        self._session.flush()
        return row
