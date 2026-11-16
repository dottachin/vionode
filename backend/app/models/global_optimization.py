from sqlalchemy import (
    ARRAY,
    BIGINT,
    JSON,
    CheckConstraint,
    Column,
    DateTime,
    Index,
    String,
    func,
)

from app.models.base import Base


class GlobalOptimization(Base):
    __tablename__ = "global_optimizations"

    id = Column(BIGINT, primary_key=True, autoincrement=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    name = Column(String(120), nullable=True)

    depot_ids = Column(ARRAY(String), nullable=False)
    site_ids = Column(ARRAY(String), nullable=False)
    vehicle_ids = Column(ARRAY(String), nullable=False)

    params = Column(JSON, nullable=False)
    metrics = Column(JSON, nullable=True)
    result = Column(JSON, nullable=True)

    solver_run_id = Column(String, nullable=True)
    result_id = Column(String, nullable=True)
    note = Column(String, nullable=True)

    __table_args__ = (
        CheckConstraint("cardinality(depot_ids) > 0", name="global_optimizations_depot_ids_nonempty"),
        CheckConstraint("cardinality(site_ids) > 0", name="global_optimizations_site_ids_nonempty"),
        CheckConstraint("cardinality(vehicle_ids) > 0", name="global_optimizations_vehicle_ids_nonempty"),
        Index("ix_global_optimizations_created_at", "created_at"),
        Index("ix_global_optimizations_name", "name"),
        Index("ix_global_optimizations_solver_run_id", "solver_run_id"),
        Index("ix_global_optimizations_result_id", "result_id"),
    )
