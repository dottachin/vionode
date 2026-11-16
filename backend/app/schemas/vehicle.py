from pydantic import BaseModel
from typing import List, Optional

class VehicleBase(BaseModel):
    label:str
    weight: float
    surface: float
    type: str
    emission_rate: float
    max_distance: int
    fuel_consumption: float
    fuel_type: str
    depot_id: Optional[str] = None
    driver_ids: List[int]

class VehicleCreate(VehicleBase):
    pass

class VehicleOut(VehicleCreate):
    id: int
    class Config:
        from_attributes = True

class VehicleUpdate(BaseModel):
    label:Optional[str] = None
    weight: Optional[float] = None
    surface: Optional[float] = None
    type: Optional[str] = None
    fuel_consumption: Optional[float] = None
    fuel_type: Optional[str] = None
    emission_rate: Optional[float] = None
    max_distance: Optional[int] = None
    depot_id: Optional[str] = None
    driver_ids: Optional[List[int]] = None
