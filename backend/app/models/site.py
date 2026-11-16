# models/site.py
from sqlalchemy import Column, String, Float, Integer
from sqlalchemy.dialects.postgresql import JSONB
from .base import Base

class Site(Base):
    __tablename__ = "sites"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    address = Column(String, nullable=False)
    category = Column(String, nullable=False)
    
    # Coordinates stored as JSON
    coordinates = Column(JSONB, nullable=False)  # {"latitude": float, "longitude": float}

    service_time = Column(Integer, nullable=False)  # In seconds or minutes, depending on your unit

    # Operational hours stored as JSON
    operational_hours = Column(JSONB, nullable=False)  # {"start": "08:00", "end": "18:00"}
