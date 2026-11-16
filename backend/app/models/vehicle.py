# models/vehicle.py
from sqlalchemy import Column, String, Float, Integer, Table, ForeignKey, ARRAY,BIGINT
from sqlalchemy.orm import relationship
from .base import Base


class Vehicle(Base):
    __tablename__ = "vehicles"

    id_vehicule = Column(BIGINT, primary_key=True, index=True)
    label = Column(String, nullable=False)
    weight = Column(Float, nullable=False)
    surface = Column(Float, nullable=False)
    conso = Column(Float, nullable=False)
    carburant = Column(String, nullable=False)
    type = Column(String, nullable=False)
    emission_rate = Column(Float, nullable=False)
    max_distance = Column(Integer, nullable=False)
    depot_id = Column(String, nullable=True)
    driver_ids = Column(ARRAY(BIGINT), nullable=False)
