from dataclasses import dataclass
from enum import Enum
from typing import Any, List, Optional, Dict, Tuple, Annotated
from pydantic import (
    BaseModel,
    Field,
    field_validator,
    model_validator,
    ConfigDict,
    FieldValidationInfo,
)
from datetime import time
import logging

# Logger setup
logger = logging.getLogger(__name__)


# ---------------------- Original Enums (Preserved Exactly) ----------------------
class EquipementEnum(str, Enum):
    LOAD_BARS = "Barres d'arrimage"
    E_TRACK = "Système E-Track"
    RATCHET_STRAPS = "Sangles à cliquet"
    CARGO_NETS = "Filets de chargement"
    REFRIGERATION_UNIT = "Groupe frigorifique"
    HAZARDOUS_MATERIAL_CONTAINER = "Contenants pour matières dangereuses"
    AIR_SUSPENSION = "Suspension pneumatique"
    SLIDING_SIDES_OR_ROOF = "Rideaux latéraux / toit coulissant"


class VehiculeTypeEnum(str, Enum):
    TRACTEUR = "tracteur"
    REMORQUE = "remorque"
    SEMI_REMORQUE = "semi remorque"
    VUL = "VUL"
    VP = "VP"
    PORTEUR = "porteur"


class HazardousMaterialEnum(str, Enum):
    POISON = "Poison"
    EXPLOSIVES = "Explosives"
    GAS = "Gas"
    FLAMMABLE = "Flammable"
    ORGANIC = "Organic"
    RADIOACTIVE = "Radioactive"
    CORROSIVE = "Corrosive"
    OTHER = "Other"
    FLAMMABLE_SOLID_COMBUSTIBLE = "Flammable solid combustible"
    HARMFUL_FOR_WATER = "Goods harmful for water"
    POISONOUS_INHALATION_HAZARD = "Poisonous inhalation hazard"
    EXPLOSIVE_AND_FLAMMABLE = "Explosive and flammable"
    UNKNOWN_TYPE = "Hazardous material type unknown"
    UNSPECIFIED_TYPE = "Unspecified hazardous material type"
    ANY_HAZARDOUS = "Any hazardous material"


class SiteCategoryEnum(str, Enum):
    DEPOT = "depot"
    VDEPOT = "virtual depot"
    VIRTUAL = "virtual site"
    HUB = "hub"
    ATELIER = "atelier"
    COMPOSANT = "composant"
    FOURNISSEUR = "fournisseur"
    FACONNIER = "faconnier"
    FOURNISSEUR_EXW = "fournisseur exw"
    RECYCLAGE = "recyclage"
    REPAIR = "repair"
    FOURNISSEUR_ITALIEN = "fournisseur italien"
    CLIENT = "client"


# ---------------------- Enhanced Models with Pydantic V2 Validators ----------------------
class TimeWindow(BaseModel):
    """Represents operational time windows with validation"""

    model_config = ConfigDict(extra="allow")

    start: time
    end: time

    @field_validator("end")
    @classmethod
    def validate_time_window(cls, v: time, info: FieldValidationInfo) -> time:
        if "start" in info.data and v <= info.data["start"]:
            raise ValueError("End time must be after start time")
        return v


class Coordinates(BaseModel):
    """Enhanced coordinate model with strict validation"""

    model_config = ConfigDict(extra="allow")

    latitude: float = Field(
        ..., ge=-90, le=90, description="Latitude in decimal degrees"
    )
    longitude: float = Field(
        ..., ge=-180, le=180, description="Longitude in decimal degrees"
    )

    def to_tuple(self) -> Tuple[float, float]:
        return (self.latitude, self.longitude)


class Site(BaseModel):
    """Enhanced site model with operational constraints"""

    model_config = ConfigDict(extra="allow")

    id: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(..., min_length=1, max_length=100)
    # Allow short placeholder addresses in tests and synthetic data
    address: str = Field(..., min_length=1, max_length=200)
    coordinates: Coordinates
    category: SiteCategoryEnum
    operational_hours: Optional[TimeWindow] = None
    is_depot: bool = False
    service_time: Optional[int] = None  # let this start as None
    demand_surface: float = Field(
        0, description="Optional pallet/surface demand at the site (used in multi-depot VRP)"
    )
    demand_weight: float = Field(
        0, description="Optional weight demand at the site (used in multi-depot VRP)"
    )

    @model_validator(mode="after")
    def set_category_defaults(self) -> "Site":
        # Flag depots
        if self.category == SiteCategoryEnum.DEPOT:
            self.is_depot = True

        # Default service_time
        if self.service_time is None:
            self.service_time = self._default_service_time_for_category()

        # Default operational_hours
        if not self.operational_hours:
            self.operational_hours = self._default_time_window_for_category()

        return self

    def _default_service_time_for_category(self) -> int:
        """Category-based service time default in seconds."""
        if self.category == SiteCategoryEnum.VDEPOT:
            return 0

        elif self.category in {
            SiteCategoryEnum.FOURNISSEUR,
            SiteCategoryEnum.VIRTUAL,
            SiteCategoryEnum.ATELIER,
            SiteCategoryEnum.COMPOSANT,
            SiteCategoryEnum.FACONNIER,
            SiteCategoryEnum.FOURNISSEUR_EXW,
            SiteCategoryEnum.RECYCLAGE,
            SiteCategoryEnum.REPAIR,
            SiteCategoryEnum.FOURNISSEUR_ITALIEN,
            SiteCategoryEnum.HUB,
            SiteCategoryEnum.DEPOT,
        }:
            return 1800  # 30 minutes

        elif self.category == SiteCategoryEnum.CLIENT:
            return 1800  # Adjust if needed

        return 1800  # Fallback default

    def _default_time_window_for_category(self) -> TimeWindow:
        if self.category in {SiteCategoryEnum.DEPOT, SiteCategoryEnum.VDEPOT}:
            return TimeWindow(start=time(0, 0), end=time(23, 59))
        else:
            return TimeWindow(start=time(0, 0), end=time(23, 59))


class Driver(BaseModel):
    """Enhanced driver model with work hour validations"""

    model_config = ConfigDict(extra="allow")

    id: str = Field(..., min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=100)
    license_number: str = Field(..., min_length=5, max_length=20)
    max_daily_driving_hours: float = Field(180, gt=0, le=168)
    max_daily_service_hours: float = Field(180, gt=0, le=168)
    max_weekly_driving_hours: float = Field(56.0, gt=0, le=60)
    max_biweekly_driving_hours: float = Field(90.0, gt=0, le=100)
    max_weekly_service_hours: float = Field(52.0, gt=0, le=60)
    avg_4week_service_hours: float = Field(50.0, gt=0, le=60)

    @model_validator(mode="after")
    def validate_hour_limits(self) -> "Driver":
        if self.max_daily_service_hours < self.max_daily_driving_hours:
            raise ValueError("Service hours must be >= driving hours")
        return self


class Vehicule(BaseModel):
    """Enhanced vehicle model with capacity validation"""

    model_config = ConfigDict(extra="allow")

    id_vehicule: str = Field(..., min_length=1, max_length=50)
    weight: Annotated[float, Field(..., gt=0, description="Max weight capacity in kg")]
    surface: Annotated[float, Field(..., gt=0, description="Floor surface in m²")]
    length: Annotated[float, Field(..., gt=0, description="Length in meters")]
    height: Annotated[float, Field(..., gt=0, description="Height in meters")]
    equipements: List[EquipementEnum] = Field(default_factory=list)
    type: VehiculeTypeEnum
    carburant: str
    conso: float
    driver_ids: List[str] = Field(default_factory=list)
    operational_cost: float = Field(0.0, ge=0)
    current_location: Optional[str] = None
    max_distance_meters: int = Field(
        default=10_000_000,
        description="Maximum allowed route distance in meters (default 100 km)",
    )
    emission_rate: float = Field(
        default=1, description="emission rate grame per meter "
    )
    depot_id: Optional[str] = Field(
        default=None,
        description="Home depot identifier for multi-depot optimization; defaults to the first depot when omitted",
    )
    fixed_cost: float = Field(
        default=0.0,
        ge=0,
        description="Fixed dispatch cost used to discourage unnecessary vehicle usage",
    )

    def can_handle_order(self, order: "Order") -> bool:
        """Check if vehicle can handle order requirements"""
        equipment_ok = all(req in self.equipements for req in order.required_utilities)
        capacity_ok = order.floor <= self.surface
        return equipment_ok and capacity_ok


class Order(BaseModel):
    """Enhanced order model with validation"""

    model_config = ConfigDict(extra="allow")

    order_id: str 
    floor: Annotated[float, Field(..., description="Number of pallets")]
    weight: Annotated[float, Field(..., description="Order weight in kg")]
    hazardous_types: List[HazardousMaterialEnum] = Field(default_factory=list)
    required_utilities: List[EquipementEnum] = Field(default_factory=list)
    source: Site
    destination: Site
    time_windows: Optional[Dict[str, TimeWindow]] = None
    priority: Annotated[int, Field(1, ge=1, le=3)]
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("hazardous_types")
    @classmethod
    def validate_hazardous_materials(
        cls, v: List[HazardousMaterialEnum]
    ) -> List[HazardousMaterialEnum]:
        if any(
            haz in v
            for haz in [
                HazardousMaterialEnum.UNKNOWN_TYPE,
                HazardousMaterialEnum.UNSPECIFIED_TYPE,
            ]
        ):
            logger.warning("Order contains unspecified hazardous materials")
        return v


class RoutingRequest(BaseModel):
    """Enhanced routing request with comprehensive validation"""

    model_config = ConfigDict(extra="allow")

    vehicles: List[Vehicule]
    drivers: List[Driver]
    # Orders are optional for multi-depot mode (site-level demands only)
    orders: List[Order] = Field(default_factory=list)
    # Explicit sites list for site-demand multi-depot scenarios
    sites: Optional[List[Site]] = None
    depots: Optional[List[Site]] = None
    vehicle_ids:Optional[list]=[]
    slack_time_seconds: Annotated[int, Field(3600, ge=0, le=86400)]
    optimization_arc: str = Field("distance", pattern=r"^(distance|duration|co2)$")
    solver_mode: str = Field("fast", pattern=r"^(balanced|fast|optimal)$")
    fixed_cost_per_route: Optional[float] = Field(
        default=None,
        ge=0,
        description="Optional fixed cost applied to each used vehicle to favor route consolidation",
    )

    @field_validator("vehicles")
    @classmethod
    def validate_vehicles(cls, v: List[Vehicule]) -> List[Vehicule]:
        if not v:
            raise ValueError("At least one vehicle is required")
        return v

    @model_validator(mode="after")
    def validate_drivers_assigned(self) -> "RoutingRequest":
        driver_ids = {d.id for d in self.drivers}
        for vehicle in self.vehicles:
            for driver_id in vehicle.driver_ids:
                if driver_id not in driver_ids:
                    raise ValueError(
                        f"Driver {driver_id} not found for vehicle {vehicle.id_vehicule}"
                    )
        return self


@dataclass
class SolverResult:
    status: str
    routes: List[Dict]
    metrics: Dict[str, float]
    unassigned_orders: List[Dict]
    assignment_details: Optional[Dict] = None
