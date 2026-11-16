from datetime import datetime, timezone
from typing import Dict, List, Optional
from pydantic import AliasChoices, BaseModel, Field, ConfigDict, computed_field, field_validator

# ---- Nested types mirroring your frontend ----

class OptimizationParams(BaseModel):
    optimization_arc: str                  # "distance" | "co2" | "duration"
    solver_mode: str                       # "balanced" | "fast" | "optimal"
    slack_time_seconds: int

class OptimizationMetrics(BaseModel):
    solve_time: float
    total_distance: float
    total_vehicles_used: int
    unassigned_orders: int
    surface_utilization: float
    weight_utilization: float
    total_co2_emissions_kg: float
    avg_co2_per_km_kg: float
    virtual_sites_reverted: Optional[int] = 0

class Metadata(BaseModel):
    timestamp: Optional[str] = "1"
    version: Optional[str] = datetime.now(timezone.utc).isoformat()

class RouteStop(BaseModel):
    site_id: str
    arrival_time: int
    service_time: int
    departure_time: int
    surface: float
    weight: float
    distance_to_next: float
    co2_to_next: Optional[float]
    original_virtual_id: Optional[str] = None

class Route(BaseModel):
    vehicle_id: str

    # Accepts "driver_ids" or legacy "driver_id", normalizes to a list[int]
    driver_ids: List[int] = Field(
        default_factory=list,
        validation_alias=AliasChoices("driver_ids", "driver_id"),
        description="Primary list of driver IDs; legacy 'driver_id' also accepted."
    )

    stops: List[RouteStop]
    total_distance: float       # meters
    total_duration: float       # seconds
    total_surface: float
    total_weight: float
    total_co2_emissions: float  # grams

    # ---- Normalization: scalar -> list[int], and coerce elements to int
    @field_validator("driver_ids", mode="before")
    @classmethod
    def _normalize_driver_ids(cls, v):
        if v is None:
            return []
        if isinstance(v, (list, tuple, set)):
            return [int(x) for x in v if x is not None and str(x) != ""]
        return [int(v)]

    # ---- Compatibility: also expose single 'driver_id' (first item) on output
    @computed_field(alias="driver_id", return_type=Optional[int])
    def driver_id(self) -> Optional[int]:
        return self.driver_ids[0] if self.driver_ids else None

class VehicleAssignment(BaseModel):
    assigned_orders: List[str]
    surface_used: float
    surface_capacity: float
    weight_used: float
    weight_capacity: float

class AssignmentDetails(BaseModel):
    vehicle_assignments: Dict[str, VehicleAssignment]
    unassigned_orders: List[str]

class OptimizationResult(BaseModel):
    status: str
    routes: List[Route]
    metrics: OptimizationMetrics
    unassigned_orders: List[str]
    metadata: Optional[Metadata] = Field(
        default_factory=lambda: Metadata(
            version="1",
            timestamp=datetime.now(timezone.utc).isoformat()
        )
    )
    assignment_details: AssignmentDetails

# ---- DB I/O payloads ----

class OptimizationBase(BaseModel):
    # Optional human-readable name
    name: Optional[str] = Field(default=None, max_length=120)

    # Link constraints (set at most one)
    milk_run_id: Optional[int] = Field(default=None)
    order_set_id: Optional[int] = Field(default=None)

    depot_id: str
    site_ids: List[str]

    # ✅ NEW: Persist vehicle selection for this run
    vehicle_ids: List[str] = Field(default_factory=list)

    params: OptimizationParams
    metrics: OptimizationMetrics

    result: Optional[OptimizationResult] = None
    solver_run_id: Optional[str] = None
    result_id: Optional[str] = None
    note: Optional[str] = None

class OptimizationCreate(OptimizationBase):
    pass

class OptimizationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)

    milk_run_id: Optional[int] = None
    order_set_id: Optional[int] = None

    depot_id: Optional[str] = None
    site_ids: Optional[List[str]] = None

    # ✅ allow patching vehicles
    vehicle_ids: Optional[List[str]] = None

    params: Optional[OptimizationParams] = None
    metrics: Optional[OptimizationMetrics] = None

    result: Optional[OptimizationResult] = None

    solver_run_id: Optional[str] = None
    result_id: Optional[str] = None
    note: Optional[str] = None

class OptimizationRead(OptimizationBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
