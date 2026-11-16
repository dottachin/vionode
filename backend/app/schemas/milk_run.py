from pydantic import BaseModel, Field
from typing import List, Optional, Dict

class MilkRunBase(BaseModel):
    name: str
    site_ids: List[str]
    depot_id: str

    # 0..N vehicles (UI may store 0 or 1)
    vehicle_ids: List[str] = Field(default_factory=list)

    # ✅ NEW: per-site assignment
    site_vehicle_map: Dict[str, str] = Field(default_factory=dict)

class MilkRunCreate(MilkRunBase):
    pass

class MilkRunOut(MilkRunBase):
    id: int
    class Config:
        from_attributes = True

class MilkRunUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    site_ids: Optional[List[str]] = None
    depot_id: Optional[str] = None
    vehicle_ids: Optional[List[str]] = None
    # ✅ NEW: allow partial update of the map
    site_vehicle_map: Optional[Dict[str, str]] = None



# ---------------------
# MilkRun Optimization Input (unchanged)
# ---------------------

class MilkRunOptimizeInput(BaseModel):
    depot_id: str
    site_ids: List[str]


# ---------------------
# Optimizer Input/Output (unchanged in this file)
# ---------------------

class SiteInput(BaseModel):
    id: str
    address: str
    coordinates: dict  # { "latitude": float, "longitude": float }
    category: str
    service_time: int
    operational_hours: dict  # { "start": "08:00", "end": "18:00" }

class OptimizerOrder(BaseModel):
    order_id: int
    floor: float
    weight: float
    hazardous_types: List[str]
    required_utilities: List[str]
    source: SiteInput
    destination: SiteInput
    priority: int

class OptimizerInput(BaseModel):
    vehicles: List[dict]
    drivers: List[dict]
    orders: List[OptimizerOrder]
    slack_time_seconds: int
    optimization_arc: str  # "distance" | "co2" | "time"
    solver_mode: str       # "default" | "balanced" | "eco"

class RouteStop(BaseModel):
    order_id: int
    site_id: str
    type: str
    arrival_time: str
    departure_time: str
    surface: float
    weight: float
    notes: Optional[str] = None

class Route(BaseModel):
    vehicle_id: int
    driver_ids: List[int]
    stops: List[RouteStop]
    total_distance_m: float
    total_duration_s: float
    total_emissions_g: float

class OptimizerMeta(BaseModel):
    strategy_used: str
    computed_at: str
    total_distance_m: float
    total_duration_s: float
    total_emissions_g: float

class OptimizerResult(BaseModel):
    routes: List[Route]
    unassigned_orders: Optional[List[str]] = None
    meta: Optional[OptimizerMeta] = None
