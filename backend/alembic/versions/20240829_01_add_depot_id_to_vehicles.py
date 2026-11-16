"""Add depot_id to vehicles

Revision ID: 20240829_01
Revises:
Create Date: 2025-08-29
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20240829_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vehicles",
        sa.Column("depot_id", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("vehicles", "depot_id")
