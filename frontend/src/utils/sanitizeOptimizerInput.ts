/* eslint-disable @typescript-eslint/no-explicit-any */
// src/utils/sanitizeOptimizerInput.ts
import { SOLVER_SITE_CATEGORIES } from "@/constants/domain";

const allowedCategories = new Set<string>(SOLVER_SITE_CATEGORIES);

export function normalizeCategory(raw?: string): string {
  const v = (raw ?? "").trim().toLowerCase();
  return allowedCategories.has(v) ? v : "client";
}

export function sanitizeSite(site: any) {
  return {
    id: String(site.id ?? site.site_id ?? ""),
    name: String(site.name ?? site.site_name ?? ""),
    address: site.address ?? "",
    coordinates: {
      latitude: Number(
        site.coordinates?.latitude ??
          site.location?.lat ??
          site.lat ??
          0
      ),
      longitude: Number(
        site.coordinates?.longitude ??
          site.location?.lng ??
          site.lng ??
          0
      ),
    },
    category: normalizeCategory(site.category),
    service_time: Number(site.service_time ?? 0),
    operational_hours: {
      start: site.operational_hours?.start ?? "00:00",
      end: site.operational_hours?.end ?? "23:59",
    },
  };
}

/**
 * Vehicles sanitizer
 * - Keeps canonical id as `id_vehicule` (string)
 * - Normalizes driver_ids to strings
 * - Defaults length/height to 1 if missing/non-numeric
 * - Converts `max_distance` (km) -> `max_distance_meters` (meters)
 *   while NOT forwarding the raw km field
 * - Preserves existing `max_distance_meters` if already present
 */
export function sanitizeVehicles(vs: any[]): any[] {
  return (vs ?? []).map((v) => {
    const {
      max_distance, // km; read for conversion, do not forward
      driver_ids = [],
      id_vehicule,
      id,
      vehicle_id,
      length,
      height,
      equipements,
      depot_id,
      fixed_cost,
      ...rest
    } = v;

    // If backend already gave meters, keep it; otherwise derive from km
    const km = Number(max_distance);
    const derivedMeters =
      v.max_distance_meters ??
      (Number.isFinite(km) && km > 0 ? Math.round(km * 1000) : undefined);

    const normalizedEquipements =
      Array.isArray(equipements)
        ? (equipements as any[]).filter(Boolean).map((x) => String(x))
        : typeof equipements === "string"
        ? equipements.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

    return {
      ...rest,
      ...(typeof derivedMeters === "number" ? { max_distance_meters: derivedMeters } : {}),
      id_vehicule: String(id_vehicule ?? id ?? vehicle_id ?? ""),
      driver_ids: (driver_ids as any[]).map((d: any) => String(d)),
      length: typeof length === "number" ? length : 1,
      height: typeof height === "number" ? height : 1,
      depot_id: depot_id != null ? String(depot_id) : undefined,
      equipements: normalizedEquipements,
      fixed_cost:
        typeof fixed_cost === "number"
          ? fixed_cost
          : typeof v.fixed_cost === "number"
          ? v.fixed_cost
          : undefined,
    };
  });
}

export function sanitizeDrivers(ds: any[]): any[] {
  return (ds ?? []).map((d) => ({
    ...d,
    id: String(d.id ?? d.driver_id ?? ""),
  }));
}

export function sanitizeOrders(os: any[]): any[] {
  return (os ?? []).map((o) => ({
    ...o,
    priority: Math.max(1, Math.min(3, Number(o.priority ?? 1))), // clamp to 1..3
    source: sanitizeSite(o.source),
    destination: sanitizeSite(o.destination),
  }));
}

function sanitizeDepots(deps: any[]): any[] {
  return (deps ?? []).map((d) => ({
    ...sanitizeSite(d),
    category: "depot",
  }));
}

function sanitizeSites(sites: any[]): any[] {
  return (sites ?? []).map((s) => {
    const base = sanitizeSite(s);
    return {
      ...base,
      demand_surface: typeof s.demand_surface === "number" ? s.demand_surface : 0,
      demand_weight: typeof s.demand_weight === "number" ? s.demand_weight : 0,
    };
  });
}

export function sanitizeOptimizerInput(input: any) {
  return {
    ...input,
    depots: sanitizeDepots(input.depots),
    ...(input.sites ? { sites: sanitizeSites(input.sites) } : {}),
    vehicles: sanitizeVehicles(input.vehicles),
    drivers: sanitizeDrivers(input.drivers),
    orders: sanitizeOrders(input.orders),
    optimization_arc: input.optimization_arc, // distance | duration | co2
    solver_mode: input.solver_mode, // balanced | fast | optimal
    slack_time_seconds: Number(input.slack_time_seconds ?? 0),
  };
}
