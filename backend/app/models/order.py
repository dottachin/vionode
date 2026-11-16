# models/order.py
from sqlalchemy import Column, String, Boolean, Float, ForeignKey,BIGINT
from sqlalchemy.orm import relationship
from .base import Base

class Order(Base):
    __tablename__ = "orders"

    id = Column(BIGINT, primary_key=True, autoincrement=True)
    pickup_site_id = Column(String, nullable=False)
    delivery_site_id = Column(String, nullable=False)
    weight = Column(Float, nullable=False)
    surface = Column(Float, nullable=False)
    goods_type = Column(String, nullable=False)
    requires_refrigeration = Column(Boolean, default=False)
    is_hazardous = Column(Boolean, default=False)
    notes = Column(String, nullable=True)

    order_set_id = Column(BIGINT, ForeignKey("order_sets.id"), nullable=True)
    order_set = relationship("OrderSet", back_populates="orders")
