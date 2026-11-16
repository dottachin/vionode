from datetime import datetime, timezone
from typing import Dict, List, Optional

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

from app.schemas.optimization import AssignmentDetails, Metadata, Route


class GlobalOptimizationParams(BaseModel):
    optimization_arc: str  # "distance" | "duration" | "co2"
    solver_mode: str  # "balanced" | "fast" | "optimal"
    slack_time_seconds: int
    fixed_cost_per_route: Optional[float] = None
    site_vehicle_map: Dict[str, str] = Field(default_factory=dict)

    model_config = ConfigDict(extra="allow")

    @field_validator("site_vehicle_map", mode="before")
    @classmethod
    def _clean_map(cls, value: Dict[str, str] | None):
        if not value:
            return {}
        if not isinstance(value, dict):
            return {}
        cleaned: Dict[str, str] = {}
        for key, val in value.items():
            k = str(key).strip()
            v = str(val).strip()
            if k and v:
                cleaned[k] = v
        return cleaned


class GlobalOptimizationMetrics(BaseModel):
    total_distance_km: float = Field(validation_alias=AliasChoices("total_distance_km", "total_distance"))
    total_duration_h: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("total_duration_h", "total_duration", "total_duration_s"),
    )
    total_co2_emissions_kg: float
    total_vehicles_used: Optional[int] = None
    unassigned_orders: Optional[int] = None
    surface_utilization: Optional[float] = None
    weight_utilization: Optional[float] = None
    avg_co2_per_km_kg: Optional[float] = None
    virtual_sites_reverted: Optional[int] = None

    model_config = ConfigDict(extra="allow")


class GlobalOptimizerResult(BaseModel):
    status: str
    routes: List[Route]
    metrics: GlobalOptimizationMetrics
    unassigned_orders: List[str]
    metadata: Optional[Metadata] = Field(
        default_factory=lambda: Metadata(
            version="1",
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    )
    assignment_details: AssignmentDetails
    steps: Optional[List[dict]] = None

    model_config = ConfigDict(extra="allow")


class GlobalOptimizationBase(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    depot_ids: List[str] = Field(default_factory=list)
    site_ids: List[str] = Field(default_factory=list)
    vehicle_ids: List[str] = Field(default_factory=list)
    params: GlobalOptimizationParams
    metrics: Optional[GlobalOptimizationMetrics] = None
    result: Optional[GlobalOptimizerResult] = None
    solver_run_id: Optional[str] = None
    result_id: Optional[str] = None
    note: Optional[str] = None

    @field_validator("depot_ids", "site_ids", "vehicle_ids", mode="before")
    @classmethod
    def _normalize_ids(cls, value):
        if value is None:
            return []
        if isinstance(value, (list, tuple, set)):
            cleaned = [str(item).strip() for item in value if str(item).strip()]
            # de-dupe while preserving order
            seen = {}
            for item in cleaned:
                seen[item] = None
            return list(seen.keys())
        value_str = str(value).strip()
        return [value_str] if value_str else []

    @field_validator("metrics", mode="before")
    @classmethod
    def _allow_empty_metrics(cls, value):
        # Treat empty objects/arrays as absence so users can save draft configs without results
        if value in (None, {}, []):
            return None
        return value


class GlobalOptimizationCreate(GlobalOptimizationBase):
    pass


class GlobalOptimizationRead(GlobalOptimizationBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


class GlobalOptimizationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    depot_ids: Optional[List[str]] = None
    site_ids: Optional[List[str]] = None
    vehicle_ids: Optional[List[str]] = None
    params: Optional[GlobalOptimizationParams] = None
    metrics: Optional[GlobalOptimizationMetrics] = None
    result: Optional[GlobalOptimizerResult] = None
    solver_run_id: Optional[str] = None
    result_id: Optional[str] = None
    note: Optional[str] = None
