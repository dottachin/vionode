// Shared domain values. These strings are sent to the solver as-is,
// so they must stay in sync with solver/route_optimizer/models/schemas.py
// and the emission factors in solver/route_optimizer/solver/constraints.py.

export const VEHICLE_TYPES = ["tractor", "trailer", "semi-trailer", "van", "car", "rigid truck"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const FUELS = [
  "Bioethanol - ED95",
  "Petrol - Unleaded (95, E10, 98)",
  "Diesel - B30",
  "Off-road diesel",
  "Road diesel - B100",
  "Road diesel - B7",
  "HVO - Hydrotreated vegetable oil",
  "Kerosene - Jet A1 / A",
  "Electricity (2022 average mix)",
] as const;
export const DEFAULT_FUEL = "Road diesel - B7";

export const SITE_CATEGORIES = [
  "depot",
  "client",
  "supplier",
  "warehouse",
  "hub",
  "workshop",
  "subcontractor",
  "recycling",
  "repair",
] as const;

/** All categories the solver accepts (includes internal virtual ones). */
export const SOLVER_SITE_CATEGORIES = [...SITE_CATEGORIES, "virtual depot", "virtual site"] as const;

export const EQUIPMENT = [
  "Load bars",
  "E-Track system",
  "Ratchet straps",
  "Cargo nets",
  "Refrigeration unit",
  "Hazardous material containers",
  "Air suspension",
  "Sliding sides / roof",
] as const;
