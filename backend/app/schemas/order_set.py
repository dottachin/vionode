from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from .order import OrderBase  # assuming you already have this

class OrderSetBase(BaseModel):
    name: str

class OrderSetCreate(OrderSetBase):
    # Let the DB generate the ID; don't require it in the request
    orders: List[OrderBase]

class OrderSetUpdate(BaseModel):
    name: Optional[str] = None
    orders: Optional[List[OrderBase]] = None

class OrderSetOut(OrderSetBase):
    id: int
    created_at: datetime
    orders: List[OrderBase]

    class Config:
        from_attributes = True
