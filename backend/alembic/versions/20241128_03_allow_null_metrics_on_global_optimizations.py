"""Allow null metrics on global_optimizations

Revision ID: 20241128_03
Revises: 20241128_02
Create Date: 2025-11-28
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20241128_03"
down_revision = "20241128_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "global_optimizations",
        "metrics",
        existing_type=sa.JSON(),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "global_optimizations",
        "metrics",
        existing_type=sa.JSON(),
        nullable=False,
    )
