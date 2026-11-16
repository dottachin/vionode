# models/driver.py
from sqlalchemy import Column, String, BIGINT, Float
from .base import Base

class Driver(Base):
    __tablename__ = "drivers"

    id = Column(BIGINT, primary_key=True, index=True, autoincrement=True)
    name = Column(String, nullable=False)  
    license_number = Column(String, nullable=False)
    max_daily_driving_hours = Column(Float, nullable=False)
    max_daily_service_hours = Column(Float, nullable=False)
