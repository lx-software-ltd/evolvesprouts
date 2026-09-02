"""Repository pattern implementations for database operations.

Repositories provide a clean abstraction over database operations,
making business logic independent of the persistence layer.
"""

from app.db.repositories.api_key import ApiKeyRepository
from app.db.repositories.asset import AssetRepository
from app.db.repositories.base import BaseRepository
from app.db.repositories.bulk_expense_import_job import BulkExpenseImportJobRepository
from app.db.repositories.contact import ContactRepository
from app.db.repositories.discount_code import DiscountCodeRepository
from app.db.repositories.enrollment import EnrollmentRepository
from app.db.repositories.expense import ExpenseRepository
from app.db.repositories.family import FamilyRepository
from app.db.repositories.geographic_area import GeographicAreaRepository
from app.db.repositories.inbound_email import InboundEmailRepository
from app.db.repositories.location import LocationRepository
from app.db.repositories.note import NoteRepository
from app.db.repositories.organization import OrganizationRepository
from app.db.repositories.sales_lead import SalesLeadRepository
from app.db.repositories.sales_lead_ai_suggestion_job import (
    SalesLeadAiSuggestionJobRepository,
)
from app.db.repositories.sales_settings import SalesSettingsRepository
from app.db.repositories.service import ServiceRepository
from app.db.repositories.service_instance import ServiceInstanceRepository
from app.db.repositories.tag import TagRepository
from app.db.repositories.whatsapp import WhatsAppRepository

__all__ = [
    "BaseRepository",
    "ApiKeyRepository",
    "AssetRepository",
    "BulkExpenseImportJobRepository",
    "SalesLeadAiSuggestionJobRepository",
    "ContactRepository",
    "NoteRepository",
    "DiscountCodeRepository",
    "EnrollmentRepository",
    "ExpenseRepository",
    "FamilyRepository",
    "GeographicAreaRepository",
    "InboundEmailRepository",
    "LocationRepository",
    "OrganizationRepository",
    "SalesLeadRepository",
    "SalesSettingsRepository",
    "ServiceRepository",
    "ServiceInstanceRepository",
    "TagRepository",
    "WhatsAppRepository",
]
