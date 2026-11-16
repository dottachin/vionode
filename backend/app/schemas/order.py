# schemas/order.py
from pydantic import BaseModel
from typing import Optional

class OrderBase(BaseModel):
    pickup_site_id: str
    delivery_site_id: str
    weight: float
    surface: float
    goods_type: Optional[str] = ""
    requires_refrigeration: bool
    is_hazardous: Optional[bool] = False
    notes: Optional[str] = None

class OrderCreate(OrderBase):
    pass

class OrderOut(OrderCreate):
    id: int
    class Config:
        from_attributes = True
