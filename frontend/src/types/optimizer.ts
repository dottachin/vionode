// src/types/optimizer.ts

import type { Driver, Vehicle } from "./vehicle";

/* ------------------------------- COMMON TYPES ------------------------------ */

export type Arc = "distance" | "co2" | "duration";
export type Solver = "balanced" | "fast" | "optimal";

/* ----------------------------- INPUT STRUCTURES ---------------------------- */

export interface SiteInput {
  id: string;
  name: string;
  address: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  category: string; // normalized to backend enum values
  service_time: number;
  operational_hours: {
    start: string;
    end: string;
  };
}

export interface SiteDemand extends SiteInput {
  demand_surface?: number;
  demand_weight?: number;
}

export interface OptimizerOrder {
  order_id: string;
  floor: number;
  weight: number;
  hazardous_types: string[];
  required_utilities: string[];
  source: SiteInput;
  destination: SiteInput;
  priority: number; // 1..3
}

export interface OptimizerInput {
  depots: SiteInput[];
  sites?: SiteDemand[];
  vehicles: Vehicle[];
  drivers: Driver[];
  orders: OptimizerOrder[];
  slack_time_seconds: number;
  // IMPORTANT: match backend regex ^(distance|duration|co2)$
  optimization_arc: Arc;
  // IMPORTANT: match backend regex ^(balanced|fast|optimal)$
  solver_mode: Solver;
  fixed_cost_per_route?: number;
}

/* ----------------------------- RESULT STRUCTURES --------------------------- */

export interface RouteStop {
  site_id: string;
  arrival_time?: number; // seconds since midnight
  arrival_time_hhmm?: string;
  service_time?: number;
  departure_time?: number;
  departure_time_hhmm?: string;
  surface?: number;
  weight?: number;
  distance_to_next?: number;
  distance_to_next_m?: number;
  distance_to_next_km?: number;
  co2_to_next?: number;
  co2_to_next_g?: number;
  co2_to_next_kg?: number;
  original_virtual_id?: string;
}

export interface Route {
  vehicle_id: string;
  depot_id?: string;
  used?: boolean;
  driver_ids?: string[];
  driver_id?: string;
  stops: RouteStop[];
  total_distance?: number;           // in meters
  total_distance_m?: number;
  total_distance_km?: number;
  total_duration?: number;           // in seconds
  total_duration_s?: number;
  total_duration_h?: number;
  total_surface?: number;
  total_weight?: number;
  total_co2_emissions?: number;      // in grams
  total_co2_emissions_g?: number;
  total_co2_emissions_kg?: number;
  fixed_cost?: number;
  assigned_orders?: string[];
  surface_used?: number;
  surface_capacity?: number;
  weight_used?: number;
  weight_capacity?: number;
}

export interface Metrics {
  solve_time?: number;
  total_distance?: number;
  total_distance_km?: number;
  total_vehicles_used?: number;
  vehicles_used?: number;
  unassigned_orders?: number;
  surface_utilization?: number;
  weight_utilization?: number;
  total_co2_emissions_kg?: number;   // NOTE: some solvers may actually return grams
  total_co2_emissions_g?: number;
  total_co2_emissions?: number;
  avg_co2_per_km_kg?: number;
  virtual_sites_reverted?: number;
}

export interface Metadata {
  timestamp: string; // ISO datetime
  version: string;
}

export interface VehicleAssignment {
  assigned_orders: string[];
  surface_used: number;
  surface_capacity: number;
  weight_used: number;
  weight_capacity: number;
}

export interface AssignmentDetails {
  vehicle_assignments: Record<string, VehicleAssignment>;
  unassigned_orders: string[];
}

export interface OptimizerResult {
  status: string;
  routes: Route[];
  metrics: Metrics;
  unassigned_orders: string[];
  steps?: string[];
  metadata: Metadata;
  assignment_details: AssignmentDetails;
}

/* --------------------------- SOLVER API RESPONSE --------------------------- */

export type OptimizeRoutesResponse = {
  result: OptimizerResult;
  metrics?: Metrics;            // optional duplicate field if solver returns it separately
  solver_run_id?: string | null;
  result_id?: string | null;    // may be unused once you persist full results in DB
};

/* ----------------------- PERSISTED OPTIMIZATION TYPES ---------------------- */

export type OptimizationParams = {
  optimization_arc: Arc;
  solver_mode: Solver;
  slack_time_seconds: number;
  fixed_cost_per_route?: number;
  site_vehicle_map?: Record<string, string>;
};

export type OptimizationRecord = {
  id: string | number;                   // DB id (often integer)
  created_at: string;                    // ISO datetime
  vehicle_ids: string[];
  // NEW: optional human-friendly name
  name?: string | null;

  milk_run_id?: string | number | null;  // optional association
  order_set_id?: string | number | null; // optional association
  depot_id: string;
  site_ids: string[];
  params: OptimizationParams;
  metrics: Metrics;

  /** Full solver result saved in DB. `null` for manual/score-only entries. */
  result: OptimizerResult | null;

  /** Optional label like "manual" or "optimized". */
  note?: string | null;

  /** Optional legacy fields if still present in your DB schema. */
  solver_run_id?: string | null;
  result_id?: string | null;
};

/** Payload used to create/save a record in backend_db */
export type OptimizationCreate = Omit<OptimizationRecord, "id" | "created_at">;

/* ------------------- GLOBAL (multi-depot) OPTIMIZATION TYPES ------------------ */
export type GlobalOptimizationRecord = {
  id: string | number;
  created_at: string;
  name?: string | null;
  depot_ids: string[];
  site_ids: string[];
  vehicle_ids: string[];
  params: OptimizationParams;
  metrics: Metrics;
  result: OptimizerResult | null;
  note?: string | null;
  solver_run_id?: string | null;
  result_id?: string | null;
};

export type GlobalOptimizationCreate = Omit<GlobalOptimizationRecord, "id" | "created_at">;

export type GlobalOptimizationUpdate = Partial<
  Omit<GlobalOptimizationCreate, "depot_ids" | "site_ids" | "vehicle_ids"> & {
    depot_ids?: string[];
    site_ids?: string[];
    vehicle_ids?: string[];
  }
>;
