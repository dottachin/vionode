from sqlalchemy import (
    Column,
    String,
    DateTime,
    ForeignKey,
    BIGINT,
    JSON,
    ARRAY,
    func,
    CheckConstraint,
    Index,
)
from sqlalchemy.orm import relationship

from app.models.base import Base

class Optimization(Base):
    __tablename__ = "optimizations"

    id = Column(BIGINT, primary_key=True, autoincrement=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Optional human-friendly name
    name = Column(String(120), nullable=True)

    # Link to either milk run OR order set (not both)
    milk_run_id = Column(BIGINT, ForeignKey("milk_runs.id", ondelete="SET NULL"), nullable=True)
    order_set_id = Column(BIGINT, ForeignKey("order_sets.id", ondelete="SET NULL"), nullable=True)

    depot_id = Column(String, nullable=False)
    site_ids = Column(ARRAY(String), nullable=False)

    # ✅ NEW: Persist the vehicle selection used for this optimization
    vehicle_ids = Column(ARRAY(String), nullable=False, default=[])

    # Parameters & metrics (normalized for your frontend)
    params = Column(JSON, nullable=False)
    metrics = Column(JSON, nullable=False)

    # Optional full solver result payload
    result = Column(JSON, nullable=True)

    # Optional references
    solver_run_id = Column(String, nullable=True)
    result_id = Column(String, nullable=True)

    note = Column(String, nullable=True)

    milk_run = relationship("MilkRun", back_populates="optimizations")
    order_set = relationship("OrderSet", back_populates="optimizations")

    __table_args__ = (
        CheckConstraint(
            "NOT (milk_run_id IS NOT NULL AND order_set_id IS NOT NULL)",
            name="optimizations_at_most_one_link",
        ),
        Index("ix_optimizations_name", "name"),
        Index("ix_optimizations_milk_run_id", "milk_run_id"),
        Index("ix_optimizations_order_set_id", "order_set_id"),
        Index("ix_optimizations_created_at", "created_at"),
    )
