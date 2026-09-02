"""Tag catalog repository: archive scoping and cross-entity usage counts."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

from sqlalchemy.dialects import postgresql

from app.db.repositories.tag import TagRepository


def _compiled(stmt: object) -> str:
    return str(
        stmt.compile(  # type: ignore[attr-defined]
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


def _repo_with_rows(rows: list[object]) -> tuple[TagRepository, MagicMock]:
    session = MagicMock()
    session.execute.return_value.scalars.return_value.all.return_value = rows
    session.execute.return_value.all.return_value = rows
    return TagRepository(session), session


def test_list_catalog_defaults_to_active_tags_ordered_by_lower_name() -> None:
    repo, session = _repo_with_rows([])
    repo.list_catalog()
    sql = _compiled(session.execute.call_args[0][0])
    assert "tags.archived_at IS NULL" in sql
    assert "ORDER BY lower(tags.name)" in sql


def test_list_catalog_archived_only_and_include_archived_scopes() -> None:
    repo, session = _repo_with_rows([])
    repo.list_catalog(archived_only=True)
    assert "tags.archived_at IS NOT NULL" in _compiled(session.execute.call_args[0][0])

    repo.list_catalog(include_archived=True)
    assert "WHERE" not in _compiled(session.execute.call_args[0][0])


def test_usage_counts_by_tag_id_short_circuits_on_empty_input() -> None:
    repo, session = _repo_with_rows([])
    assert repo.usage_counts_by_tag_id([]) == {}
    session.execute.assert_not_called()


def test_usage_counts_by_tag_id_unions_every_link_table() -> None:
    tag_id = uuid4()
    repo, session = _repo_with_rows([(tag_id, 7)])
    assert repo.usage_counts_by_tag_id([tag_id]) == {tag_id: 7}
    sql = _compiled(session.execute.call_args[0][0])
    for table in (
        "contact_tags",
        "family_tags",
        "organization_tags",
        "asset_tags",
        "service_tags",
        "service_instance_tags",
    ):
        assert table in sql
    assert sql.count("UNION ALL") == 5


def test_usage_count_reads_single_tag_total() -> None:
    tag_id = uuid4()
    repo, _session = _repo_with_rows([(tag_id, 2)])
    assert repo.usage_count(tag_id) == 2
    other_repo, _ = _repo_with_rows([])
    assert other_repo.usage_count(tag_id) == 0
