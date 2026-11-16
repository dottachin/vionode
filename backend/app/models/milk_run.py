from sqlalchemy import ARRAY, Column, String, Table, ForeignKey, BIGINT
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import text
from .base import Base

milk_run_sites = Table(
    "milk_run_sites",
    Base.metadata,
    Column("milk_run_id", BIGINT, ForeignKey("milk_runs.id"), primary_key=True),
    Column("site_id", String, ForeignKey("sites.id"), primary_key=True),
)

class MilkRun(Base):
    __tablename__ = "milk_runs"

    id = Column(BIGINT, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)

    # Ordered list of sites
    site_ids = Column(ARRAY(String), nullable=False)

    # Depot
    depot_id = Column(String, nullable=False)

    # 0..N vehicles chosen at run level
    vehicle_ids = Column(ARRAY(String), nullable=False, default=[])

    # ✅ NEW: per-site vehicle assignment map { siteId: vehicleId }
    site_vehicle_map = Column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )

    sites = relationship("Site", secondary=milk_run_sites, backref="milk_runs")

    optimizations = relationship(
        "Optimization",
        back_populates="milk_run",
        cascade="all, delete-orphan",
    )
