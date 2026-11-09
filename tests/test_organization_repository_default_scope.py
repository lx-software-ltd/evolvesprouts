"""CRM default scope for organization list/count (vendor + partner excluded)."""

from __future__ import annotations

from unittest.mock import MagicMock

import app.db.repositories.organization as organization_module
from app.db.models import RelationshipType
from app.db.repositories.organization import OrganizationRepository
from sqlalchemy.dialects import postgresql


def _relationship_loader_strategies(stmt: object) -> set[tuple[str, str]]:
    """Return lazy-loader pairs applied to a list statement."""
    strategies: set[tuple[str, str]] = set()
    for option in getattr(stmt, "_with_options", ()):
        for element in getattr(option, "context", ()):
            strategy = getattr(element, "strategy", None)
            if not strategy:
                continue
            for pair in strategy:
                if isinstance(pair, tuple) and len(pair) == 2:
                    strategies.add((str(pair[0]), str(pair[1])))
    return strategies


def test_crm_default_relationship_tuple_excludes_vendor_and_partner() -> None:
    types = organization_module._CRM_DEFAULT_RELATIONSHIP_TYPES
    assert RelationshipType.VENDOR not in types
    assert RelationshipType.PARTNER not in types
    assert RelationshipType.PROSPECT in types


def test_list_organizations_default_where_excludes_vendor_and_partner() -> None:
    """Default branch must not return vendor or partner rows (compiled SQL check)."""
    mock_session = MagicMock()
    list_result = MagicMock()
    list_result.scalars.return_value.unique.return_value.all.return_value = []
    mock_session.execute.return_value = list_result

    repo = OrganizationRepository(mock_session)
    repo.list_organizations(limit=5, include_relationships=False)

    stmt = mock_session.execute.call_args[0][0]
    sql = str(
        stmt.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "relationship_type IN" in sql
    assert "'vendor'" not in sql
    assert "'partner'" not in sql
    assert "'prospect'" in sql
    assert _relationship_loader_strategies(stmt) == {("lazy", "raise")}


def test_count_organizations_default_matches_list_filter() -> None:
    mock_session = MagicMock()
    mock_session.execute.return_value.scalar_one_or_none.return_value = 0
    repo = OrganizationRepository(mock_session)
    repo.count_organizations()

    stmt = mock_session.execute.call_args[0][0]
    sql = str(
        stmt.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "relationship_type IN" in sql
    assert "'vendor'" not in sql
    assert "'partner'" not in sql


def test_get_non_vendor_organization_by_id_allows_partner_rows() -> None:
    mock_session = MagicMock()
    mock_session.execute.return_value.scalar_one_or_none.return_value = None
    repo = OrganizationRepository(mock_session)
    from uuid import uuid4

    repo.get_non_vendor_organization_by_id(uuid4())
    stmt = mock_session.execute.call_args[0][0]
    sql = str(
        stmt.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "relationship_type != 'vendor'" in sql
