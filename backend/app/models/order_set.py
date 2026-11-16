# models/order_set.py
from sqlalchemy import Column, String, DateTime, BIGINT
from sqlalchemy.orm import relationship
from .base import Base
from datetime import datetime

class OrderSet(Base):
    __tablename__ = "order_sets"

    id = Column(BIGINT, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    orders = relationship("Order", back_populates="order_set", cascade="all, delete")
    # NEW: back-populate optimizations
    optimizations = relationship("Optimization", back_populates="order_set", cascade="all, delete-orphan")
