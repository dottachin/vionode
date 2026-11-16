// src/components/optimizer/OptimizerResults.tsx
/* eslint-disable react-hooks/exhaustive-deps */
import { memo, useEffect, useMemo, useState } from "react";
import type { Site } from "@/types/site";
import type { OptimizerResult, VehicleAssignment } from "@/types/optimizer";
import type { Vehicle, Driver } from "@/types/vehicle";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import {
  Brain,
  Truck,
  User,
  Route as RouteIcon,
  Timer,
  Leaf,
  Layers,
  Weight,
  Save,
  AlertTriangle,
} from "lucide-react";

import RouteMap from "@/components/optimizer/RouteMap";

/* ------------------------- Scale factors (env overridable) ------------------------- */
const SURFACE_SCALE_FACTOR = Number(import.meta.env.VITE_SURFACE_SCALE_FACTOR ?? 100);
const WEIGHT_SCALE_FACTOR = Number(import.meta.env.VITE_WEIGHT_SCALE_FACTOR ?? 100);

/* ------------------------- Extended Props for saving + labels ------------------------ */
type Props = {
  result: OptimizerResult; // inner result: { status, routes, metrics, ... }
  sites: Site[];
  defaultName?: string;
  saving?: boolean;
  onSave?: (name: string) => void;
  /** Optional for nicer labels */
  vehicles?: Vehicle[];
  drivers?: Driver[];
  mapkey?: string;
  /** Disable editing of the “Optimization name” input */
  nameDisabled?: boolean;
};

/* ------------------------------ Helpers (format) ------------------------------ */

const useFormatters = () => {
  const nf0 = useMemo(
    () => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
    []
  );
  const nf1 = useMemo(
    () => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }),
    []
  );
  const nf2 = useMemo(
    () => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }),
    []
  );

  const formatPct = (v?: number | null) =>
    typeof v === "number" ? `${nf1.format(v * 100)} %` : "—";
  const formatKmFromKm = (km?: number | null) =>
    typeof km === "number" ? `${nf1.format(km)} km` : "—";
  const formatKgFromKg = (kg?: number | null) =>
    typeof kg === "number" ? `${nf1.format(kg)} kg` : "—";

  const hhmmFromMinutes = (minutes?: number | null) => {
    if (typeof minutes !== "number" || Number.isNaN(minutes)) return "—";
    const total = Math.max(0, Math.round(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const mmssFromSeconds = (seconds?: number | null) => {
    if (typeof seconds !== "number" || Number.isNaN(seconds)) return "—";
    const total = Math.max(0, Math.round(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return {
    nf0,
    nf1,
    nf2,
    formatPct,
    formatKmFromKm,
    formatKgFromKg,
    hhmmFromMinutes,
    mmssFromSeconds,
  };
};

/* ---------------------- Types (aligned to your shape) ---------------------- */

type Stop = {
  site_id: string;

  // legacy
  distance_to_next?: number; // meters
  co2_to_next?: number; // grams
  service_time?: number; // seconds
  arrival_time?: number; // epoch s
  departure_time?: number; // epoch s

  // normalized (new)
  distance_to_next_m?: number;
  distance_to_next_km?: number;
  co2_to_next_g?: number;
  co2_to_next_kg?: number;
  arrival_time_hhmm?: string;
  departure_time_hhmm?: string;

  surface?: number;
  weight?: number;
  original_virtual_id?: string | null;
};

type Route = {
  depot_id?: string;
  used?: boolean;
  vehicle_id: string;
  // BACKEND CHANGE: now a list of drivers
  driver_ids?: string[];
  // backward compat (older runs)
  driver_id?: string;

  // legacy
  total_distance?: number; // meters
  total_co2_emissions?: number; // grams
  total_duration?: number; // seconds

  // normalized (new)
  total_distance_m?: number;
  total_distance_km?: number;
  total_co2_emissions_g?: number;
  total_co2_emissions_kg?: number;
  total_duration_s?: number;
  total_duration_h?: number;

  total_surface?: number;
  total_weight?: number;
  assigned_orders?: string[];
  surface_used?: number;
  surface_capacity?: number;
  weight_used?: number;
  weight_capacity?: number;

  stops: Stop[];
};

type RouteDetails = {
  vehicle_id: string;
  depot_id?: string;
  used?: boolean;
  driver_ids: string[];
  total_distance_km: number;
  total_co2_emissions: number; // kg
  total_duration_hours: number;
  total_surface?: number;
  total_weight?: number;
  assigned_orders: string[];
  surface_used: number;
  surface_capacity: number;
  weight_used: number;
  weight_capacity: number;
  segments: Array<{
    from_site: string;
    from_site_id: string;
    to_site: string;
    to_site_id: string;
    distance_km: number;
    CO2: number; // kg
    travel_time_min: number;
    service_time_min: number;
    arrival_time: string; // "HH:MM"
    departure_time: string; // "HH:MM"
    surface_change: number;
    weight_change: number;
    current_surface: number;
    current_weight: number;
    original_virtual_id?: string | null;
  }>;
};

/* ------------------------------ Virtual helpers ------------------------------ */

const isVirtualStop = (s?: Stop) => {
  if (!s) return false;
  if (s.original_virtual_id) return true;
  const id = String(s.site_id ?? "");
  // Treat source *and* destination virtuals as virtual, plus any generic _virtual_
  return (
    id.includes("_virtual_source_") ||
    id.includes("_virtual_destination_") ||
    id.includes("_virtual_")
  );
};

/** Sum numeric with safety */
const add = (a?: number, b?: number) =>
  (typeof a === "number" ? a : 0) + (typeof b === "number" ? b : 0);

/** Safe percent */
const pct = (used?: number | null, cap?: number | null) => {
  const u = typeof used === "number" ? used : 0;
  const c = typeof cap === "number" && cap > 0 ? cap : 0;
  if (c === 0) return 0;
  return Math.max(0, Math.min(100, (u / c) * 100));
};

/** Normalize driver ids list (handle older runs) */
const normalizeDriverIds = (route: Route): string[] => {
  if (Array.isArray(route.driver_ids) && route.driver_ids.length) return route.driver_ids;
  if (route.driver_id) return [String(route.driver_id)];
  return [];
};

/**
 * Remove virtual stops from display and roll their distances/CO₂ into the
 * preceding real stop so segments go real→real only.
 * Also merge adjacent real stops with the same site_id **only if they are true duplicates**.
 */
function collapseVirtualAndMergeAdjacent(stops: Stop[]): Stop[] {
  if (!stops?.length) return [];

  // indexes of real stops
  const realIdxs: number[] = [];
  for (let i = 0; i < stops.length; i++) {
    if (!isVirtualStop(stops[i])) realIdxs.push(i);
  }
  if (realIdxs.length === 0) return [];
  if (realIdxs.length === 1) return [{ ...stops[realIdxs[0]] }];

  // start with shallow copies of the real stops
  const out: Stop[] = realIdxs.map((i) => ({ ...stops[i] }));

  // clear edge metrics; we'll recompute
  for (const s of out) {
    delete s.distance_to_next;
    delete s.distance_to_next_m;
    delete s.distance_to_next_km;
    delete s.co2_to_next;
    delete s.co2_to_next_g;
    delete s.co2_to_next_kg;
  }

  // For each span between consecutive real stops, sum all intermediate legs
  for (let j = 0; j < realIdxs.length - 1; j++) {
    const iStart = realIdxs[j];
    const iEnd = realIdxs[j + 1];

    let d_m = 0,
      d_km = 0,
      c_g = 0,
      c_kg = 0;

    for (let k = iStart; k < iEnd; k++) {
      const st = stops[k];
      if (typeof st.distance_to_next_km === "number") d_km += st.distance_to_next_km;
      else if (typeof st.distance_to_next_m === "number") d_m += st.distance_to_next_m;
      else if (typeof st.distance_to_next === "number") d_m += st.distance_to_next;

      if (typeof st.co2_to_next_kg === "number") c_kg += st.co2_to_next_kg;
      else if (typeof st.co2_to_next_g === "number") c_g += st.co2_to_next_g;
      else if (typeof st.co2_to_next === "number") c_g += st.co2_to_next;
    }

    if (d_km > 0 || d_m > 0) {
      out[j].distance_to_next_km = d_km + d_m / 1000;
    }
    if (c_kg > 0 || c_g > 0) {
      out[j].co2_to_next_kg = c_kg + c_g / 1000;
    }
  }

  // merge adjacent real stops with same site_id **only** if they are true duplicates
  const merged: Stop[] = [];
  let cur = out[0];
  for (let j = 1; j < out.length; j++) {
    const nxt = out[j];
    const sameSite = nxt.site_id === cur.site_id;

    // No edge metrics between cur -> nxt (i.e., no real movement aggregated there)
    const noEdge =
      !(typeof cur.distance_to_next_km === "number" && cur.distance_to_next_km > 0) &&
      !(typeof cur.distance_to_next_m === "number" && cur.distance_to_next_m > 0) &&
      !(typeof cur.distance_to_next === "number" && cur.distance_to_next > 0) &&
      !(typeof cur.co2_to_next_kg === "number" && cur.co2_to_next_kg > 0) &&
      !(typeof cur.co2_to_next_g === "number" && cur.co2_to_next_g > 0) &&
      !(typeof cur.co2_to_next === "number" && cur.co2_to_next > 0);

    // Same timestamps (indicates a duplicate label, not a traveled leg)
    const sameTimes =
      typeof cur.arrival_time === "number" &&
      typeof nxt.arrival_time === "number" &&
      cur.arrival_time === nxt.arrival_time &&
      typeof cur.departure_time === "number" &&
      typeof nxt.departure_time === "number" &&
      cur.departure_time === nxt.departure_time;

    if (sameSite && noEdge && sameTimes) {
      // combine service/distance/co2 and keep latest departure label
      cur.service_time = add(cur.service_time, nxt.service_time);
      if (typeof nxt.departure_time === "number") cur.departure_time = nxt.departure_time;
      if (typeof nxt.departure_time_hhmm === "string")
        cur.departure_time_hhmm = nxt.departure_time_hhmm;

      if (
        typeof nxt.distance_to_next_km === "number" ||
        typeof cur.distance_to_next_km === "number"
      ) {
        cur.distance_to_next_km = add(cur.distance_to_next_km, nxt.distance_to_next_km);
      } else if (
        typeof nxt.distance_to_next_m === "number" ||
        typeof cur.distance_to_next_m === "number"
      ) {
        cur.distance_to_next_m = add(cur.distance_to_next_m, nxt.distance_to_next_m);
      } else {
        cur.distance_to_next = add(cur.distance_to_next, nxt.distance_to_next);
      }

      if (
        typeof nxt.co2_to_next_kg === "number" ||
        typeof cur.co2_to_next_kg === "number"
      ) {
        cur.co2_to_next_kg = add(cur.co2_to_next_kg, nxt.co2_to_next_kg);
      } else if (
        typeof nxt.co2_to_next_g === "number" ||
        typeof cur.co2_to_next_g === "number"
      ) {
        cur.co2_to_next_g = add(cur.co2_to_next_g, nxt.co2_to_next_g);
      } else {
        cur.co2_to_next = add(cur.co2_to_next, nxt.co2_to_next);
      }
    } else {
      merged.push(cur);
      cur = nxt;
    }
  }
  merged.push(cur);
  return merged;
}

/* ---------------------- Create details (real→real segments) ---------------------- */

function createRouteDetails(route: Route, sites: Site[]): RouteDetails | null {
  const rawStops = route?.stops ?? [];
  const cleaned = rawStops.length ? collapseVirtualAndMergeAdjacent(rawStops) : [];

  const siteById: Record<string, Site> = {};
  for (const s of sites) siteById[s.id] = s;

  const pickNum = (...vals: Array<number | undefined | null>) =>
    vals.find((v) => typeof v === "number" && !Number.isNaN(v)) ?? 0;

  const total_distance_km = pickNum(
    (route as any).total_distance_km, // may already be provided
    typeof route.total_distance_m === "number" ? route.total_distance_m / 1000 : undefined,
    typeof route.total_distance === "number" ? route.total_distance / 1000 : undefined
  );

  const total_co2_emissions_kg = pickNum(
    (route as any).total_co2_emissions_kg,
    typeof route.total_co2_emissions_g === "number"
      ? route.total_co2_emissions_g / 1000
      : undefined,
    typeof route.total_co2_emissions === "number"
      ? route.total_co2_emissions / 1000
      : undefined
  );

  const total_duration_hours = pickNum(
    (route as any).total_duration_h,
    typeof route.total_duration_s === "number" ? route.total_duration_s / 3600 : undefined,
    typeof route.total_duration === "number" ? route.total_duration / 3600 : undefined
  );

  const details: RouteDetails = {
    vehicle_id: route.vehicle_id,
    depot_id: route.depot_id,
    used: route.used,
    driver_ids: normalizeDriverIds(route),
    total_distance_km,
    total_co2_emissions: total_co2_emissions_kg,
    total_duration_hours,
    total_surface: route.total_surface,
    total_weight: route.total_weight,
    assigned_orders: route.assigned_orders ?? [],
    surface_used: route.surface_used ?? 0,
    surface_capacity: route.surface_capacity ?? 0,
    weight_used: route.weight_used ?? 0,
    weight_capacity: route.weight_capacity ?? 0,
    segments: [],
  };

  const hasMovement = cleaned.some((s, i) => i > 0 && cleaned[i - 1].site_id !== s.site_id);

  // ---------- normal real→real segments ----------
  for (let i = 0; i < cleaned.length - 1; i++) {
    const cur = cleaned[i];
    const nxt = cleaned[i + 1];

    const curSite = siteById[cur.site_id];
    const nxtSite = siteById[nxt.site_id];
    if (!curSite || !nxtSite) continue;

    const sameSite = cur.site_id === nxt.site_id;
    if (sameSite) continue; // skip intra-site; tail depot events handled separately below

    const distance_km = pickNum(
      cur.distance_to_next_km,
      typeof cur.distance_to_next_m === "number" ? cur.distance_to_next_m / 1000 : undefined,
      typeof cur.distance_to_next === "number" ? cur.distance_to_next / 1000 : undefined
    );

    const co2_kg = pickNum(
      cur.co2_to_next_kg,
      typeof cur.co2_to_next_g === "number" ? cur.co2_to_next_g / 1000 : undefined,
      typeof cur.co2_to_next === "number" ? cur.co2_to_next / 1000 : undefined
    );

    const travel_time_min =
      typeof cur.departure_time === "number" && typeof nxt.arrival_time === "number"
        ? (nxt.arrival_time - cur.departure_time) / 60
        : 0;

    const service_time_min = (cur.service_time ?? 0) / 60;

    const departureLabel =
      typeof cur.departure_time_hhmm === "string"
        ? cur.departure_time_hhmm
        : typeof cur.departure_time === "number"
        ? new Date(cur.departure_time * 1000).toISOString().substring(11, 16)
        : "N/A";

    const arrivalLabel =
      typeof nxt.arrival_time_hhmm === "string"
        ? nxt.arrival_time_hhmm
        : typeof nxt.arrival_time === "number"
        ? new Date(nxt.arrival_time * 1000).toISOString().substring(11, 16)
        : "N/A";

    details.segments.push({
      from_site: curSite.name,
      from_site_id: cur.site_id,
      to_site: nxtSite.name,
      to_site_id: nxt.site_id,
      distance_km,
      CO2: co2_kg,
      travel_time_min,
      service_time_min,
      departure_time: departureLabel,
      arrival_time: arrivalLabel,
      surface_change: (nxt.surface ?? 0) - (cur.surface ?? 0),
      weight_change: (nxt.weight ?? 0) - (cur.weight ?? 0),
      current_surface: nxt.surface ?? 0,
      current_weight: nxt.weight ?? 0,
      original_virtual_id: cur.original_virtual_id ?? null,
    });
  }

  // ---------- TAIL DEPOT EVENTS (preserve unloads at depot as 0 km rows) ----------
  if (hasMovement) {
    // Collect consecutive *_virtual_destination_* from tail + final real depot.
    const tailVirtuals: Stop[] = [];
    let lastRealDepot: Stop | null = null;

    for (let i = rawStops.length - 1; i >= 0; i--) {
      const s = rawStops[i];
      const id = String(s.site_id ?? "");

      if (id.includes("_virtual_destination_")) {
        tailVirtuals.push(s);
        continue;
      }

      if (!isVirtualStop(s)) {
        lastRealDepot = s; // expected to be the final depot
        break;
      }

      // any other virtual at tail → stop scanning
      break;
    }

    if (tailVirtuals.length && lastRealDepot) {
      tailVirtuals.reverse(); // chronological
      const depotSite = siteById[lastRealDepot.site_id];
      if (depotSite) {
        const chain = [...tailVirtuals, lastRealDepot];
        for (let i = 0; i < chain.length - 1; i++) {
          const a = chain[i];
          const b = chain[i + 1];

          const travel_time_min =
            typeof a.departure_time === "number" && typeof b.arrival_time === "number"
              ? (b.arrival_time - a.departure_time) / 60
              : 0;

          const service_time_min = (a.service_time ?? 0) / 60;

          const departureLabel =
            typeof a.departure_time_hhmm === "string"
              ? a.departure_time_hhmm
              : typeof a.departure_time === "number"
              ? new Date(a.departure_time * 1000).toISOString().substring(11, 16)
              : "N/A";

          const arrivalLabel =
            typeof b.arrival_time_hhmm === "string"
              ? b.arrival_time_hhmm
              : typeof b.arrival_time === "number"
              ? new Date(b.arrival_time * 1000).toISOString().substring(11, 16)
              : "N/A";

          details.segments.push({
            from_site: depotSite.name,
            from_site_id: depotSite.id,
            to_site: depotSite.name,
            to_site_id: depotSite.id,
            distance_km: 0,
            CO2: 0,
            travel_time_min,
            service_time_min,
            departure_time: departureLabel,
            arrival_time: arrivalLabel,
            surface_change: (b.surface ?? 0) - (a.surface ?? 0),
            weight_change: (b.weight ?? 0) - (a.weight ?? 0),
            current_surface: b.surface ?? 0,
            current_weight: b.weight ?? 0,
            original_virtual_id: String(a.site_id),
          });
        }
      }
    }
  }

  return details;
}

/* --------------------------------- Component -------------------------------- */

function OptimizerResults({
  result,
  sites,
  defaultName,
  saving,
  onSave,
  vehicles,
  drivers,
  mapkey,
  nameDisabled = false,
}: Props) {
  const {
    nf1,
    nf2,
    formatKmFromKm,
    formatKgFromKg,
    formatPct,
    hhmmFromMinutes,
    mmssFromSeconds,
  } = useFormatters();

  const routes = result?.routes ?? [];
  const visibleRoutes = useMemo(
    () =>
      (routes as any[]).filter((r) => {
        if (r?.used === false) return false;
        if (Array.isArray((r as any)?.stops)) return (r as any).stops.length > 0;
        return true;
      }),
    [routes]
  );
  const metrics = result?.metrics;
  const status = String(result?.status ?? "");
  const statusIsNoSolution =
    status.toLowerCase() === "no_solution" ||
    (Array.isArray(visibleRoutes) && visibleRoutes.length === 0);

  const siteMap = useMemo(() => {
    const m = new Map<string, Site>();
    for (const s of sites ?? []) m.set(String((s as any).id), s);
    return m;
  }, [sites]);

  // Label maps (optional)
  const vehicleMap = useMemo(() => {
    const m = new Map<string, Vehicle>();
    for (const v of vehicles ?? []) {
      const id = String((v as any).id_vehicule ?? (v as any).id ?? (v as any).vehicle_id);
      m.set(id, v);
    }
    return m;
  }, [vehicles]);

  const driverMap = useMemo(() => {
    const m = new Map<string, Driver>();
    for (const d of drivers ?? []) m.set(String((d as any).id), d);
    return m;
  }, [drivers]);

  const depotLabelFor = (depotId?: string) =>
    depotId ? siteMap.get(String(depotId))?.name ?? String(depotId) : '-';

  const vehicleLabelFor = (vehId: string) => {
    const v = vehicleMap.get(vehId) as any;
    return v?.label || v?.name || vehId;
  };

  /** Resolve list of driver names from ids, fallback to assignment hints */
  const resolveDriverNames = (
    ids: Array<string | number> | undefined,
    assign?: VehicleAssignment | undefined
  ): string[] => {
    const names: string[] = [];

    if (Array.isArray(ids) && ids.length) {
      for (const rawId of ids) {
        const id = String(rawId); // <-- cast numbers (and anything else) to string
        const d = driverMap.get(id) as any;
        if (d?.name) names.push(d.name);
      }
    }

    if (names.length === 0 && assign) {
      const a: any = assign;
      const fromAssign = a.name;
      if (Array.isArray(fromAssign)) return fromAssign.filter(Boolean);
      if (typeof fromAssign === "string") return [fromAssign];
    }

    return names;
  };

  // naming & save
  const [name, setName] = useState(defaultName ?? "");
  useEffect(() => {
    setName(defaultName ?? "");
  }, [defaultName]);

  // Build details per route (filtered to used routes)
  const routeDetails = useMemo(() => {
    return visibleRoutes
      .map((r) => createRouteDetails(r as unknown as Route, sites))
      .filter((d): d is RouteDetails => !!d)
      .filter((d) => d.used !== false);
  }, [visibleRoutes, sites]);

  const hasAnyRoutes = routeDetails.length > 0;

  // Aggregate only from visible (detailed) routes
  const totalDistanceFromRoutes = routeDetails.reduce(
    (sum, d) => sum + d.total_distance_km,
    0
  );
  const totalDurationFromRoutes = routeDetails.reduce(
    (sum, d) => sum + d.total_duration_hours,
    0
  );
  const totalEmissionsFromRoutes = routeDetails.reduce(
    (sum, d) => sum + d.total_co2_emissions,
    0
  );

  // scale helpers
  const scaleSurface = (v?: number | null) =>
    typeof v === "number" ? v / SURFACE_SCALE_FACTOR : 0;
  const scaleWeight = (v?: number | null) =>
    typeof v === "number" ? v / WEIGHT_SCALE_FACTOR : 0;
  const fmtSurface = (v?: number | null) => nf2.format(scaleSurface(v));

  const metricsDistanceKm =
    (metrics as any)?.total_distance_km ??
    (typeof metrics?.total_distance === "number" ? metrics.total_distance / 1000 : undefined);
  const metricsDurationHours =
    (metrics as any)?.total_duration_h ??
    (typeof (metrics as any)?.total_duration_s === "number"
      ? (metrics as any).total_duration_s / 3600
      : undefined);
  const metricsEmissionsKg =
    (metrics as any)?.total_co2_emissions_kg ??
    (typeof (metrics as any)?.total_co2_emissions_g === "number"
      ? (metrics as any).total_co2_emissions_g / 1000
      : typeof (metrics as any)?.total_co2_emissions === "number"
      ? (metrics as any).total_co2_emissions / 1000
      : undefined);
  const summaryDistanceKm =
    typeof metricsDistanceKm === "number" ? metricsDistanceKm : totalDistanceFromRoutes;
  const summaryDurationHours =
    typeof metricsDurationHours === "number" ? metricsDurationHours : totalDurationFromRoutes;
  const summaryEmissionsKg =
    typeof metricsEmissionsKg === "number" ? metricsEmissionsKg : totalEmissionsFromRoutes;
  const vehiclesUsedMetric = metrics?.total_vehicles_used ?? (metrics as any)?.vehicles_used;

  return (
    <div className="space-y-6">
      {/* Summary ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-muted-foreground" aria-hidden />
                Optimization summary
                {statusIsNoSolution && (
                  <Badge variant="destructive" className="ml-2">
                    No solution
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {statusIsNoSolution
                  ? "No feasible route with the current constraints."
                  : "Global details and assignments (routes with segments only)."}
              </CardDescription>
            </div>

            {/* Name + Save controls */}
            {!nameDisabled && (
              <div className="flex items-end gap-2">
                <div className="w-64">
                  <label className="mb-1 block text-sm">Optimization name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={defaultName ?? "Name"}
                  />
                </div>
                <Button
                  onClick={() => onSave?.(name)}
                  disabled={!onSave || saving || !hasAnyRoutes}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-3">
          {/* If no solution, show helpful guidance */}
          {statusIsNoSolution ? (
            <div className="rounded-md border border-dashed p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm">
                    No route could be built. Some things to check:
                  </p>
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    <li>Insufficient vehicle capacity (surface/weight).</li>
                    <li>Max distance or range constraints are too strict.</li>
                    <li>Incompatible time windows between sites and vehicles.</li>
                    <li>No vehicle assigned to sites (manual mode) or no vehicle selected (optimization).</li>
                    <li>Unreachable sites or time/distance matrix could not be computed.</li>
                  </ul>

                  {/* Show minimal metrics/diagnostics if present */}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {typeof metrics?.solve_time === "number" && (
                      <div className="flex items-center gap-2">
                        <Timer className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          Temps de calcul : <b>{mmssFromSeconds(metrics.solve_time)}</b>
                        </span>
                      </div>
                    )}
                    {(result.unassigned_orders?.length ?? 0) > 0 && (
                      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
                        <Badge variant="destructive">Unassigned</Badge>
                        <span className="text-sm">
                          {result.unassigned_orders!.join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-center gap-2">
                  <RouteIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="text-sm">
                    Total distance: <b>{formatKmFromKm(summaryDistanceKm)}</b>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Timer className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="text-sm">
                    Total duration:{" "}
                    <b>{hhmmFromMinutes(summaryDurationHours * 60)}</b>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Leaf className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="text-sm">
                    Total emissions:{" "}
                    <b>{formatKgFromKg(summaryEmissionsKg)}</b>
                  </span>
                </div>

                {typeof vehiclesUsedMetric === "number" && (
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-sm">
                      Vehicles used: <b>{vehiclesUsedMetric}</b>
                    </span>
                  </div>
                )}

                {typeof metrics?.surface_utilization === "number" && (
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-sm">
                      Utilisation surface :{" "}
                      <b>{formatPct(metrics.surface_utilization)}</b>
                    </span>
                  </div>
                )}

                {typeof metrics?.weight_utilization === "number" && (
                  <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
                    <Weight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-sm">
                      Weight utilization:{" "}
                      <b>{formatPct(metrics.weight_utilization)}</b>
                    </span>
                  </div>
                )}

                {typeof metrics?.solve_time === "number" && (
                  <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
                    <Timer className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-sm">
                      Temps de calcul : <b>{mmssFromSeconds(metrics.solve_time)}</b>
                    </span>
                  </div>
                )}
              </div>

              {(result.unassigned_orders?.length ?? 0) > 0 && (
                <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-1" />
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-destructive">Unassigned orders</div>
                    <div className="text-sm break-all">{result.unassigned_orders!.join(", ")}</div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Per-route details ------------------------------------------------------ */}
      {!statusIsNoSolution && (
        <div className="space-y-6">
          {routeDetails.map((details, idx) => {
            const assign: VehicleAssignment | undefined =
              result.assignment_details?.vehicle_assignments?.[details.vehicle_id];

            const vehicleLabel = vehicleLabelFor(details.vehicle_id);
            const depotLabel = depotLabelFor(details.depot_id);
            const used = details.used !== false;
            const driverNames = resolveDriverNames(details.driver_ids, assign);
            const surfPct = pct(assign?.surface_used ?? details.surface_used, assign?.surface_capacity ?? details.surface_capacity);
            const weightPct = pct(assign?.weight_used ?? details.weight_used, assign?.weight_capacity ?? details.weight_capacity);

            return (
              <Card key={`${details.vehicle_id}-${details.driver_ids.join("-")}-${idx}`}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
                    Vehicle <b>{vehicleLabel || details.vehicle_id}</b>
                    <Badge variant="outline">Depot: {depotLabel}</Badge>
                    {used ? (
                      <Badge variant="secondary">Used</Badge>
                    ) : (
                      <Badge variant="destructive">Unused</Badge>
                    )}
                    <span className="mx-2 hidden sm:inline text-muted-foreground">/</span>
                    <User className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-muted-foreground">Conducteur(s)</span>
                    <div className="flex flex-wrap gap-1">
                      {driverNames.length > 0 ? (
                        driverNames.map((nm, i) => (
                          <Badge key={`${details.vehicle_id}-drv-${i}`} variant="secondary">
                            {nm}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="outline">-</Badge>
                      )}
                    </div>
                  </CardTitle>
                  <CardDescription className="space-y-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>
                        Distance : <b>{nf1.format(details.total_distance_km)} km</b>
                      </span>
                      <span>
                        Duration:{" "}
                        <b>{hhmmFromMinutes(details.total_duration_hours * 60)}</b>
                      </span>
                      <span>
                        CO₂ : <b>{nf1.format(details.total_co2_emissions)} kg</b>
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
                      {(assign?.surface_capacity ?? details.surface_capacity) > 0 && (
                        <div className="flex items-center gap-3">
                          <Layers className="h-4 w-4 text-muted-foreground" />
                          <div className="w-full">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Surface</span>
                              <span>
                                {fmtSurface(assign?.surface_used ?? details.surface_used)} / {fmtSurface(assign?.surface_capacity ?? details.surface_capacity)}
                              </span>
                            </div>
                            <Progress value={surfPct} className="h-2 mt-1" />
                          </div>
                        </div>
                      )}

                      {(assign?.weight_capacity ?? details.weight_capacity) > 0 && (
                        <div className="flex items-center gap-3">
                          <Weight className="h-4 w-4 text-muted-foreground" />
                          <div className="w-full">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Weight</span>
                              <span>
                                {nf1.format(scaleWeight(assign?.weight_used ?? details.weight_used))} / {nf1.format(scaleWeight(assign?.weight_capacity ?? details.weight_capacity))} kg
                              </span>
                            </div>
                            <Progress value={weightPct} className="h-2 mt-1" />
                          </div>
                        </div>
                      )}
                    </div>

                    {details.assigned_orders?.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {details.assigned_orders.map((o, i) => (
                          <Badge key={`${details.vehicle_id}-ord-${i}`} variant="outline">
                            {o}
                          </Badge>
                        ))}
                  </div>
                )}
              </CardDescription>
            </CardHeader>

            {!details.segments.length && (
              <div className="px-6 pb-4 text-sm text-muted-foreground">
                {used
                  ? "No stops returned for this vehicle."
                  : "Route marked as unused by the solver."}
              </div>
            )}

            {details.segments.length > 0 && (
              <CardContent className="p-0">
                    <div className="w-full overflow-x-auto">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow>
                            <TableHead>From</TableHead>
                            <TableHead>To</TableHead>
                            <TableHead className="text-right">Distance</TableHead>
                            <TableHead className="text-right">CO₂</TableHead>
                            <TableHead className="text-right">Travel</TableHead>
                            <TableHead className="text-right">Loading/Unloading</TableHead>
                            <TableHead className="text-right">Departure</TableHead>
                            <TableHead className="text-right">Arrival</TableHead>
                            <TableHead className="text-right">Δ Surface</TableHead>
                            <TableHead className="text-right">Δ Weight</TableHead>
                            <TableHead className="text-right">Surface (to)</TableHead>
                            <TableHead className="text-right">Weight (to)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {details.segments.map((seg, i) => {
                            const deltaSurf = scaleSurface(seg.surface_change);
                            const currSurf = scaleSurface(seg.current_surface);
                            const deltaW = scaleWeight(seg.weight_change);
                            const currW = scaleWeight(seg.current_weight);
                            return (
                              <TableRow key={`${details.vehicle_id}-seg-${i}`}>
                                <TableCell className="font-mono text-xs">{seg.from_site}</TableCell>
                                <TableCell className="font-mono text-xs">{seg.to_site}</TableCell>
                                <TableCell className="text-right">{nf1.format(seg.distance_km)} km</TableCell>
                                <TableCell className="text-right">{nf1.format(seg.CO2)} kg</TableCell>
                                <TableCell className="text-right">{hhmmFromMinutes(seg.travel_time_min)}</TableCell>
                                <TableCell className="text-right">{hhmmFromMinutes(seg.service_time_min)}</TableCell>
                                <TableCell className="text-right">{seg.departure_time}</TableCell>
                                <TableCell className="text-right">{seg.arrival_time}</TableCell>
                                <TableCell className="text-right">
                                  {deltaSurf >= 0 ? `+${nf2.format(deltaSurf)}` : nf2.format(deltaSurf)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {deltaW >= 0 ? `+${nf2.format(deltaW)} kg` : `${nf2.format(deltaW)} kg`}
                                </TableCell>
                                <TableCell className="text-right">{nf2.format(currSurf)}</TableCell>
                                <TableCell className="text-right">{nf2.format(currW)} kg</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Map */}
      {!statusIsNoSolution && (
        <RouteMap
          routes={visibleRoutes}
          sites={sites}
          vehicles={vehicles}
          drivers={drivers}
          mapKey={mapkey}
        />
      )}
    </div>
  );
}

export default memo(OptimizerResults);






