from pydantic import BaseModel
from typing import Optional

class DriverBase(BaseModel):
    name: str
    license_number: Optional[str] = "111111111"
    max_daily_driving_hours: float
    max_daily_service_hours: float

class DriverCreate(DriverBase):
    pass

class DriverOut(DriverBase):
    id: int

    class Config:
        from_attributes = True  # SQLAlchemy -> Pydantic mapping

class DriverUpdate(BaseModel):
    name: Optional[str] = None
    license_number: Optional[str] = None
    max_daily_driving_hours: Optional[float] = None
    max_daily_service_hours: Optional[float] = None
