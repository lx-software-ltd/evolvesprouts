"""Allow the contact_merge API token scope.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: existing seed SQL does not insert ``api_keys`` rows.
2. No new NOT NULL columns.
3. N/A — no renamed or dropped columns.
4. N/A — no new table. Tokens are created in Admin.
5. Allowed scope values gain ``contact_merge``. Seed has no scope rows.
6. No foreign keys. No seed insert-order impact.

Result: No seed SQL update.

Downgrade restores the previous check. It fails if a ``contact_merge`` row
still exists, so those tokens are revoked before downgrade rather than
widened to ``admin``.

Revision id: ``0093_api_key_merge_scope`` (24 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0093_api_key_merge_scope"
down_revision: Union[str, None] = "0092_insight_instructions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_CHECK = "scope IN ('admin', 'user', 'contact_merge')"
_OLD_CHECK = "scope IN ('admin', 'user')"


def upgrade() -> None:
    """Accept contact_merge on api_keys.scope."""
    op.drop_constraint("api_keys_scope_allowed", "api_keys", type_="check")
    op.create_check_constraint(
        "api_keys_scope_allowed",
        "api_keys",
        _NEW_CHECK,
    )


def downgrade() -> None:
    """Restore the admin/user scope check."""
    op.drop_constraint("api_keys_scope_allowed", "api_keys", type_="check")
    op.create_check_constraint(
        "api_keys_scope_allowed",
        "api_keys",
        _OLD_CHECK,
    )
