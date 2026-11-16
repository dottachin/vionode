"""Create global_optimizations table

Revision ID: 20241128_02
Revises: 20240829_01
Create Date: 2025-11-28
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20241128_02"
down_revision = "20240829_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "global_optimizations",
        sa.Column("id", sa.BIGINT(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("name", sa.String(length=120), nullable=True),
        sa.Column("depot_ids", sa.ARRAY(sa.String()), nullable=False),
        sa.Column("site_ids", sa.ARRAY(sa.String()), nullable=False),
        sa.Column("vehicle_ids", sa.ARRAY(sa.String()), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("solver_run_id", sa.String(), nullable=True),
        sa.Column("result_id", sa.String(), nullable=True),
        sa.Column("note", sa.String(), nullable=True),
        sa.CheckConstraint("cardinality(depot_ids) > 0", name="global_optimizations_depot_ids_nonempty"),
        sa.CheckConstraint("cardinality(site_ids) > 0", name="global_optimizations_site_ids_nonempty"),
        sa.CheckConstraint("cardinality(vehicle_ids) > 0", name="global_optimizations_vehicle_ids_nonempty"),
    )
    op.create_index(
        "ix_global_optimizations_created_at",
        "global_optimizations",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_global_optimizations_name",
        "global_optimizations",
        ["name"],
        unique=False,
    )
    op.create_index(
        "ix_global_optimizations_solver_run_id",
        "global_optimizations",
        ["solver_run_id"],
        unique=False,
    )
    op.create_index(
        "ix_global_optimizations_result_id",
        "global_optimizations",
        ["result_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_global_optimizations_result_id", table_name="global_optimizations")
    op.drop_index("ix_global_optimizations_solver_run_id", table_name="global_optimizations")
    op.drop_index("ix_global_optimizations_name", table_name="global_optimizations")
    op.drop_index("ix_global_optimizations_created_at", table_name="global_optimizations")
    op.drop_table("global_optimizations")
