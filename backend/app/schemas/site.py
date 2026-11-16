from pydantic import BaseModel
from typing import Dict, Optional

class SiteBase(BaseModel):
    name: str
    address: str
    category: str
    coordinates: Dict[str, float]  # {"latitude": 1.23, "longitude": 4.56}
    service_time: int
    operational_hours: Dict[str, str]  # {"start": "08:00", "end": "18:00"}

class SiteCreate(SiteBase):
    id: str

class SiteOut(SiteCreate):
    class Config:
        from_attributes = True

class SiteUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    category: Optional[str] = None
    coordinates: Optional[Dict[str, float]] = None
    service_time: Optional[int] = None
    operational_hours: Optional[Dict[str, str]] = None
