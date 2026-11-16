/* eslint-disable @typescript-eslint/no-explicit-any */
// src/pages/CompareResultsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { Site } from "@/types/site";
import type { OptimizationRecord, OptimizerResult } from "@/types/optimizer";
import type { Vehicle, Driver } from "@/types/vehicle";

import { fetchSites } from "@/api/site";
import { fetchMilkRuns } from "@/api/milk_runs";
import { fetchOrderSets } from "@/api/order_sets";
import {
  fetchOptimizationsByMilkRun,
  fetchOptimizationsByOrderSet,
} from "@/api/optimizations";
import { fetchVehicles, fetchDrivers } from "@/api/vehicles";

import OptimizerResults from "@/components/optimizer/OptimizerResults";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Layers3,
  GitCompare,
  ListChecks,
  Download,
  Radar,
  X,
  ChevronsUpDown,
  Check,
} from "lucide-react";

/* New UI pieces for dropdowns */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "@/components/ui/select";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";

/* ----------------------------- Error Boundary ----------------------------- */
import React from "react";
class SimpleErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: any) {
    console.error("[Compare] child error:", err);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          Display unavailable for this item.
        </div>
      );
    }
    return this.props.children as any;
  }
}

/* ----------------------------- Types & helpers ----------------------------- */
type SimpleRun = { id: string; name: string };
type SimpleSet = { id: string; name: string };

type MetricKey =
  | "total_distance"
  | "total_duration"
  | "vehicles_used"
  | "total_co2_emissions_kg"
  | "total_service_time";

type MetricRowDef = {
  key: MetricKey;
  label: string;
  betterWhen: "lower" | "higher";
  format: (v: number | undefined) => string;
};

// Formatters
const fmtInt = (n?: number) =>
  typeof n === "number" && Number.isFinite(n) ? Intl.NumberFormat().format(Math.round(n)) : "—";
const fmt1 = (n?: number) =>
  typeof n === "number" && Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : "—";

// HH:MM from hours
const fmtHHMMFromHours = (h?: number) => {
  if (typeof h !== "number" || !Number.isFinite(h)) return "—";
  const totalMin = Math.max(0, Math.round(h * 60));
  const HH = String(Math.floor(totalMin / 60)).padStart(2, "0");
  const MM = String(totalMin % 60).padStart(2, "0");
  return `${HH}:${MM}`;
};

// Define the rows to compare (canonical units: km, hours, kg)
const METRICS: MetricRowDef[] = [
  { key: "total_distance", label: "Total distance", betterWhen: "lower", format: (v) => `${fmtInt(v)} km` },
  { key: "total_duration", label: "Total duration", betterWhen: "lower", format: fmtHHMMFromHours },
  { key: "total_co2_emissions_kg", label: "CO₂ total", betterWhen: "lower", format: (v) => `${fmt1(v)} kg` },
  { key: "vehicles_used", label: "Vehicles used", betterWhen: "lower", format: fmtInt },
];



/* ------------------------- Safe extractors from result ------------------------- */
function getResultPayload(rec: OptimizationRecord): OptimizerResult | null {
  return (rec as any).result ?? null;
}

function sumRoutes(
  res: OptimizerResult | null,
  pick: (route: any) => number | undefined
): number | undefined {
  if (!res?.routes?.length) return undefined;
  let total = 0;
  let found = false;
  for (const r of res.routes as any[]) {
    const v = pick(r);
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v;
      found = true;
    }
  }
  return found ? total : undefined;
}

function countVehiclesUsed(res: OptimizerResult | null): number | undefined {
  if (!res?.routes?.length) return undefined;
  let n = 0;
  for (const r of res.routes as any[]) {
    if (Array.isArray(r.stops) && r.stops.length > 2) n += 1;
  }
  return n || undefined;
}

// canonical getters (km / hours / kg)
function getDistanceKm(rec: OptimizationRecord): number | undefined {
  const m = (rec.metrics as any) || {};
  if (typeof m.total_distance_km === "number") return m.total_distance_km;
  if (typeof m.total_distance === "number") {
    return m.total_distance > 1e4 ? m.total_distance / 1000 : m.total_distance;
  }
  const res = getResultPayload(rec);
  const fromRoutesKm = sumRoutes(res, (r) =>
    typeof r.total_distance_km === "number"
      ? r.total_distance_km
      : typeof r.total_distance_m === "number"
      ? r.total_distance_m / 1000
      : typeof r.total_distance === "number"
      ? r.total_distance / 1000
      : undefined
  );
  return fromRoutesKm;
}

function getCO2Kg(rec: OptimizationRecord): number | undefined {
  const m = (rec?.result?.metrics as any) || {};
  if (typeof m.total_co2_emissions_kg === "number") return m.total_co2_emissions_kg;
  if (typeof m.total_co2_emissions_g === "number") return m.total_co2_emissions_g / 1000;
  if (typeof m.total_co2_emissions === "number") {
    return m.total_co2_emissions > 5000 ? m.total_co2_emissions / 1000 : m.total_co2_emissions;
  }
  const res = getResultPayload(rec);
  const fromRoutesKg = sumRoutes(res, (r) =>
    typeof r.total_co2_emissions_kg === "number"
      ? r.total_co2_emissions_kg
      : typeof r.total_co2_emissions_g === "number"
      ? r.total_co2_emissions_g / 1000
      : typeof r.total_co2_emissions === "number"
      ? r.total_co2_emissions > 5000
        ? r.total_co2_emissions / 1000
        : r.total_co2_emissions
      : undefined
  );
  return fromRoutesKg;
}

// function maxRoutes(
//   res: OptimizerResult | null,
//   pick: (route: any) => number | undefined
// ): number | undefined {
//   if (!res?.routes?.length) return undefined;
//   let maxVal = -Infinity;
//   let found = false;
//   for (const r of res.routes as any[]) {
//     const v = pick(r);
//     if (typeof v === "number" && Number.isFinite(v)) {
//       maxVal = Math.max(maxVal, v);
//       found = true;
//     }
//   }
//   return found ? maxVal : undefined;
// }
function getDriveDurationHours(rec: OptimizationRecord): number | undefined {
  // Prefer aggregated value if your backend already provides it
  const m = ((rec as any)?.result?.metrics as any) ?? ((rec as any).metrics as any) ?? {};
  if (typeof m.total_duration_h === "number") return m.total_duration_h;              // hours
  if (typeof m.total_duration_hours === "number") return m.total_duration_hours;      // hours
  if (typeof m.total_duration_minutes === "number") return m.total_duration_minutes / 60;

  // Otherwise, SUM durations across all routes (not max)
  const res = getResultPayload(rec);
  const sumHours = sumRoutes(res, (r) =>
    typeof r.total_duration_h === "number"
      ? r.total_duration_h
      : typeof r.total_duration_s === "number"
      ? r.total_duration_s / 3600
      : typeof r.total_duration === "number"
      ? r.total_duration / 3600
      : undefined
  );
  return sumHours;
}

function getServiceTimeHours(rec: OptimizationRecord): number | undefined {
  const m = (rec.metrics as any) || {};
  if (typeof m.total_service_time_h === "number") return m.total_service_time_h;
  if (typeof m.total_service_time_hours === "number") return m.total_service_time_hours;
  if (typeof m.total_service_time_minutes === "number") return m.total_service_time_minutes / 60;

  const res = getResultPayload(rec);
  if (!res?.routes?.length) return undefined;
  let sec = 0;
  let found = false;
  for (const r of res.routes as any[]) {
    if (!Array.isArray(r.stops)) continue;
    for (const s of r.stops) {
      if (typeof s?.service_time === "number") {
        sec += s.service_time;
        found = true;
      }
    }
  }
  return found ? sec / 3600 : undefined;
}

function getVehiclesUsed(rec: OptimizationRecord): number | undefined {
  const m = (rec.metrics as any) || {};
  if (typeof m.total_vehicles_used === "number") return m.total_vehicles_used;
  if (typeof m.vehicles_used === "number") return m.vehicles_used;
  if (typeof m.active_vehicles === "number") return m.active_vehicles;
  return countVehiclesUsed(getResultPayload(rec));
}

// metric getter
function getMetric(rec: OptimizationRecord | undefined, key: MetricKey): number | undefined {
  if (!rec) return undefined;
  switch (key) {
    case "total_distance":
      return getDistanceKm(rec);
    case "total_co2_emissions_kg":
      return getCO2Kg(rec);
    case "total_duration":
      return getDriveDurationHours(rec);
    case "total_service_time":
      return getServiceTimeHours(rec);
    case "vehicles_used":
      return getVehiclesUsed(rec);
    default:
      return undefined;
  }
}

function deltaClass(delta: number | null | undefined, betterWhen: "lower" | "higher") {
  if (delta == null) return "";
  const isBetter = betterWhen === "lower" ? delta < 0 : delta > 0;
  const isWorse = betterWhen === "lower" ? delta > 0 : delta < 0;
  if (isBetter) return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (isWorse) return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  return "bg-muted text-muted-foreground";
}

function formatDelta(delta: number | null | undefined, row: MetricRowDef) {
  if (delta == null) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  if (row.key === "total_distance") return `${sign}${fmtInt(Math.abs(delta))} km`;
  if (row.key === "total_co2_emissions_kg") return `${sign}${fmt1(Math.abs(delta))} kg`;
  if (row.key === "vehicles_used") return `${sign}${fmtInt(Math.abs(delta))}`;
  if (row.key === "total_duration" || row.key === "total_service_time")
    return `${sign}${fmtHHMMFromHours(Math.abs(delta))}`;
  return `${sign}${fmt1(Math.abs(delta))}`;
}

/* ---------------------------------- Page ---------------------------------- */
export default function CompareResultsPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [milkRuns, setMilkRuns] = useState<SimpleRun[]>([]);
  const [orderSets, setOrderSets] = useState<SimpleSet[]>([]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);

  const [activeKind, setActiveKind] = useState<"milk_run" | "order_set" | null>(null);
  const [activeParentId, setActiveParentId] = useState<string | null>(null);

  const [availableResults, setAvailableResults] = useState<OptimizationRecord[]>([]);
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [onlyDiffs, setOnlyDiffs] = useState(true);
  const [showMaps, setShowMaps] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // UI state for controls
  const [sourceValue, setSourceValue] = useState<string>(""); // "mr:ID" or "os:ID"
  const [resultsPickerOpen, setResultsPickerOpen] = useState(false);

  // Epoch to force fresh Leaflet instances when selection changes
  const [mapEpoch, setMapEpoch] = useState(0);

  // load static lists (+ vehicles & drivers)
  useEffect(() => {
    (async () => {
      try {
        const [siteList, runsRaw, setsRaw, vehRaw, drvRaw] = await Promise.all([
          fetchSites(),
          fetchMilkRuns(),
          fetchOrderSets(),
          fetchVehicles(),
          fetchDrivers(),
        ]);
        setSites(siteList || []);
        setMilkRuns(
          (runsRaw || []).map((r: any) => ({
            id: String(r.id),
            name: r.name ?? `Milk run ${String(r.id)}`,
          }))
        );
        setOrderSets(
          (setsRaw || []).map((s: any) => ({
            id: String(s.id),
            name: s.name ?? `Set ${String(s.id)}`,
          }))
        );
        // normalize vehicle IDs to string for consistency
        const normalizedVehicles = (vehRaw || []).map((v: any) => ({
          ...v,
          id_vehicule: String(v.id_vehicule ?? v.id ?? v.vehicle_id ?? ""),
        }));
        setVehicles(normalizedVehicles as Vehicle[]);
        setDrivers((drvRaw || []) as Driver[]);
      } catch (e) {
        console.error(e);
        toast.error("Loading error", {
          description: "Could not fetch sites, milk runs, order sets, vehicles or drivers.",
        });
      }
    })();
  }, []);

  // fetch results per parent
  const loadOptimizations = async (kind: "milk_run" | "order_set", id: string) => {
    try {
      setIsLoading(true);
      setAvailableResults([]);
      setSelectedResultIds([]);
      setBaselineId(null);
      const rows =
        kind === "milk_run" ? await fetchOptimizationsByMilkRun(id) : await fetchOptimizationsByOrderSet(id);
      const sorted = (rows || []).sort(
        (a: any, b: any) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
      );
      setAvailableResults(sorted);
    } catch (e) {
      console.error(e);
      toast.error("Could not load results");
    } finally {
      setIsLoading(false);
    }
  };

  const handleChooseParentFromValue = (value: string) => {
    setSourceValue(value);
    if (!value) return;
    const [prefix, id] = value.split(":");
    if (prefix === "mr") {
      setActiveKind("milk_run");
      setActiveParentId(id);
      loadOptimizations("milk_run", id);
    } else if (prefix === "os") {
      setActiveKind("order_set");
      setActiveParentId(id);
      loadOptimizations("order_set", id);
    }
  };

  // Select / unselect results
  const toggleResult = (id: string) => {
    setSelectedResultIds((prev) => {
      // Unselect
      if (prev.includes(id)) {
        // If removing the base -> clear everything to restart
        if (baselineId === id) {
          setBaselineId(null);
          return [];
        }
        return prev.filter((x) => x !== id);
      }

      // Add new
      if (prev.length >= 3) {
        toast.info("Limit", { description: "You can compare up to 3 results." });
        return prev;
      }

      const next = [...prev, id];

      // First-ever selection becomes base
      if (!baselineId) setBaselineId(id);

      return next;
    });
  };

  // force fresh map containers on any selection change
  useEffect(() => {
    setMapEpoch((e) => e + 1);
  }, [selectedResultIds.join(",")]);

  const selectedRecordsMap = useMemo(() => {
    const m = new Map<string, OptimizationRecord>();
    for (const r of availableResults) {
      const id = String(r.id);
      if (selectedResultIds.includes(id)) m.set(id, r);
    }
    return m;
  }, [availableResults, selectedResultIds]);

  const selectedRecords = useMemo(
    () => selectedResultIds.map((id) => selectedRecordsMap.get(id)).filter(Boolean) as OptimizationRecord[],
    [selectedResultIds, selectedRecordsMap]
  );

  const baselineRecord = useMemo(
    () => (baselineId ? selectedRecordsMap.get(baselineId) ?? null : null),
    [baselineId, selectedRecordsMap]
  );

  // base pinned left; others in selection order
  const orderedSelected = useMemo(() => {
    const others = selectedRecords.filter((r) => String(r.id) !== String(baselineId));
    return baselineRecord ? [baselineRecord, ...others] : [...others];
  }, [baselineRecord, baselineId, selectedRecords]);

  // Optional local filter text used inside CommandInput
  const filteredAvailable = useMemo(() => {
    if (!query) return availableResults;
    const q = query.toLowerCase();
    return availableResults.filter((r) => {
      const when = r.created_at ? new Date(r.created_at).toLocaleString() : "";
      const arc = r.params?.optimization_arc ?? "";
      const mode = r.params?.solver_mode ?? "";
      const name = r.name ?? "";
      return [String(r.id), when, arc, mode, name].some((s) => String(s).toLowerCase().includes(q));
    });
  }, [availableResults, query]);

  /* ------------------------------ CSV Export ------------------------------ */
  const exportCSV = () => {
    if (!orderedSelected.length) return;
    const headers = ["id", "name", "date", "arc", "mode", ...METRICS.map((m) => m.key)];
    const rows = orderedSelected.map((r) => [
      String(r.id),
      r.name ?? "",
      r.created_at ? new Date(r.created_at).toISOString() : "",
      r.params?.optimization_arc ?? "",
      r.params?.solver_mode ?? "",
      ...METRICS.map((m) => getMetric(r, m.key) ?? ""),
    ]);
    const csv =
      [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compare_${activeKind ?? "results"}_${activeParentId ?? "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // How many columns for detail cards (1–3)
  const detailCols = Math.max(1, Math.min(3, orderedSelected.length || 0));

  /* ---------------------------------- UI ---------------------------------- */
  return (
    <div className="space-y-8 p-6">
      <header className="flex items-center gap-2">
        <GitCompare className="h-6 w-6 text-muted-foreground" aria-hidden />
        <h1 className="text-2xl font-bold">Compare results</h1>
      </header>

      {/* Source + Results Pickers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-muted-foreground" />
            Choose source and results
          </CardTitle>
          <CardDescription>
            Select a <strong>milk run</strong> or an <strong>order set</strong>, then choose up to 3 results to compare.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Row: Source select + Multi-select results + Toggles */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            {/* Source Select */}
            <div className="w-full lg:w-80">
              <Label className="mb-2 block">Source</Label>
              <Select value={sourceValue} onValueChange={handleChooseParentFromValue}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a milk run or order set…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Milk runs</SelectLabel>
                    {milkRuns.length === 0 ? (
                      <SelectItem value="mr:_none" disabled>No milk runs</SelectItem>
                    ) : milkRuns.map((r) => (
                      <SelectItem key={`mr:${r.id}`} value={`mr:${r.id}`}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Order sets</SelectLabel>
                    {orderSets.length === 0 ? (
                      <SelectItem value="os:_none" disabled>No order sets</SelectItem>
                    ) : orderSets.map((s) => (
                      <SelectItem key={`os:${s.id}`} value={`os:${s.id}`}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* Results Multi-Select */}
            <div className="w-full lg:flex-1">
              <Label className="mb-2 block">Results to compare</Label>

              <Popover open={resultsPickerOpen} onOpenChange={setResultsPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={resultsPickerOpen}
                    className="w-full justify-between"
                    disabled={!activeParentId || isLoading}
                  >
                    {selectedResultIds.length > 0
                      ? `${selectedResultIds.length} selected`
                      : activeParentId
                        ? "Choose results…"
                        : "Choose a source first"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[520px] p-0" align="start">
                  <Command
                    filter={(value, search) => {
                      // Keep default partial matching behaviour
                      return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                    }}
                  >
                    <CommandInput
                      placeholder="Search by #id, name, date, arc, mode…"
                      value={query}
                      onValueChange={setQuery}
                    />
                    <CommandEmpty>No results.</CommandEmpty>
                    <CommandGroup heading={
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Available results</span>
                        <span className="inline-flex items-center gap-1">
                          {isLoading && <Radar className="h-3.5 w-3.5 animate-spin" />}
                          {filteredAvailable.length} items
                        </span>
                      </div>
                    }>
                      {filteredAvailable.map((rec) => {
                        const idStr = String(rec.id);
                        const selected = selectedResultIds.includes(idStr);
                        const isBase = baselineId === idStr;
                        const when = rec.created_at ? new Date(rec.created_at).toLocaleString() : "—";
                        const arc = rec.params?.optimization_arc ?? "—";
                        const mode = rec.params?.solver_mode ?? "—";
                        const name = rec.name?.trim();

                        return (
                          <CommandItem
                            key={idStr}
                            value={`${idStr} ${name ?? ""} ${when} ${arc} ${mode}`}
                            onSelect={() => toggleResult(idStr)}
                            className="flex items-center gap-2"
                          >
                            <div
                              className={`flex h-4 w-4 items-center justify-center rounded border ${
                                selected ? "bg-primary text-primary-foreground" : "bg-background"
                              }`}
                            >
                              {selected && <Check className="h-3 w-3" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                {isBase && (
                                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                    BASE
                                  </span>
                                )}
                                <span className="truncate">{name || `Result #${idStr}`}</span>
                                <span className="text-muted-foreground text-xs">{when}</span>
                                <Badge variant="outline">{arc}/{mode}</Badge>
                              </div>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </Command>
                  <div className="flex items-center justify-between border-t p-2">
                    <div className="text-xs text-muted-foreground">
                      {selectedResultIds.length}/3 selected
                      {baselineId && (
                        <span> · base: #{baselineId}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelectedResultIds([]);
                          setBaselineId(null);
                        }}
                      >
                        Clear
                      </Button>
                      <Button size="sm" onClick={() => setResultsPickerOpen(false)}>
                        Done
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Selected chips */}
              {selectedResultIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedResultIds.map((id) => {
                    const isBase = baselineId === id;
                    const rec = availableResults.find((r) => String(r.id) === id);
                    const label = rec?.name?.trim() || `#${id}`;
                    return (
                      <Badge key={id} variant={isBase ? "default" : "secondary"} className="flex items-center gap-2">
                        {isBase && "BASE "}
                        <span className="truncate max-w-[24ch]">{label}</span>
                        <button
                          className="ml-1 hover:opacity-70"
                          onClick={(e) => {
                            e.preventDefault();
                            toggleResult(id);
                          }}
                          aria-label={`Retirer ${label}`}
                          title="Retirer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Toggles */}
            <div className="flex flex-col gap-3 w-full lg:w-72">
              <div className="flex items-center justify-between">
                <Label htmlFor="onlyDiffs" className="text-sm">Differences only</Label>
                <Switch id="onlyDiffs" checked={onlyDiffs} onCheckedChange={setOnlyDiffs} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showMaps" className="text-sm">Show maps</Label>
                <Switch id="showMaps" checked={showMaps} onCheckedChange={setShowMaps} />
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="text-xs text-muted-foreground">
                  {isLoading ? (
                    <span className="inline-flex items-center gap-1">
                      <Radar className="h-3.5 w-3.5 animate-spin" /> Loading…
                    </span>
                  ) : activeParentId ? (
                    <span>{availableResults.length} result(s) found</span>
                  ) : (
                    <span>Choose a source</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedResultIds([]);
                      setBaselineId(null);
                    }}
                    disabled={selectedResultIds.length === 0}
                  >
                    Reset
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportCSV} disabled={orderedSelected.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    Export CSV
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sticky Compare Bar */}
      {orderedSelected.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-30">
          <div className="mx-auto max-w-7xl rounded-xl border bg-background/95 backdrop-blur p-3 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm">
                  {orderedSelected.length} selected
                  {orderedSelected[0] && (
                    <span className="text-muted-foreground"> — base: #{String(orderedSelected[0].id)}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedResultIds([]);
                    setBaselineId(null);
                  }}
                >
                  Reset
                </Button>
                <Button variant="outline" onClick={exportCSV}>
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setSelectedResultIds([]);
                    setBaselineId(null);
                  }}
                >
                  Clear comparison
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Comparison Summary */}
      {orderedSelected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Comparison summary</CardTitle>
            <CardDescription>
              The baseline is always shown on the left. Colors vs baseline:{" "}
              <span className="text-emerald-700">green = better</span>,{" "}
              <span className="text-rose-700">red = worse</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div
                className="grid"
                style={{ gridTemplateColumns: `260px repeat(${orderedSelected.length}, minmax(220px,1fr))` }}
              >
                {/* Header row (names) */}
                <div className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">Metric</div>
                {orderedSelected.map((rec, idx) => (
                  <div
                    key={String(rec.id)}
                    className={`px-3 py-2 text-xs font-semibold uppercase truncate ${
                      idx === 0 ? "text-primary" : "text-muted-foreground"
                    }`}
                    title={rec.name ?? `#${String(rec.id)}`}
                  >
                    {idx === 0 && (
                      <span className="mr-2 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        BASE
                      </span>
                    )}
                    <span className="truncate">{rec.name ?? `#${String(rec.id)}`}</span>
                  </div>
                ))}

                {/* Arc/Mode row */}
                <div className="px-3 py-3 border-t font-medium">Arc / Mode</div>
                {orderedSelected.map((rec) => (
                  <div key={String(rec.id)} className="px-3 py-3 border-t">
                    <Badge variant="outline">
                      {(rec.params?.optimization_arc ?? "—")}/{(rec.params?.solver_mode ?? "—")}
                    </Badge>
                  </div>
                ))}

                {/* Metric rows */}
                {METRICS
                  .filter((row) => {
                    if (!onlyDiffs || orderedSelected.length === 1) return true;
                    const baseV = getMetric(orderedSelected[0], row.key);
                    return orderedSelected.some((r, i) => i > 0 && getMetric(r, row.key) !== baseV);
                  })
                  .map((row) => {
                    const baseV = getMetric(orderedSelected[0], row.key);
                    return (
                      <div key={row.key} className="contents">
                        <div className="px-3 py-3 border-t font-medium">{row.label}</div>
                        {orderedSelected.map((rec, idx) => {
                          const val = getMetric(rec, row.key);
                          const delta = idx > 0 && baseV != null && val != null ? val - baseV : null;
                          return (
                            <div key={String(rec.id)} className="px-3 py-3 border-t">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{row.format(val)}</span>
                                {idx > 0 && delta !== null && (
                                  <span className={`text-xs rounded px-2 py-0.5 ${deltaClass(delta, row.betterWhen)}`}>
                                    {formatDelta(delta, row)}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detailed cards — BASE first, always left */}
      {orderedSelected.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">Details</h2>
          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: `repeat(${detailCols}, minmax(0, 1fr))` }}
          >
            {orderedSelected.map((rec, idx) => {
              const idStr = String(rec.id);
              const res: OptimizerResult | null = getResultPayload(rec);
              const arc = rec.params?.optimization_arc ?? "—";
              const mode = rec.params?.solver_mode ?? "—";
              const when = rec.created_at ? new Date(rec.created_at).toLocaleString() : "—";
              const name = rec.name?.trim();
              const isBaseline = idx === 0;

              return (
                <Card
                  key={idStr}
                  className={`overflow-hidden transition-shadow ${
                    isBaseline ? "border-primary/70 ring-2 ring-primary/30 shadow-sm" : ""
                  }`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2">
                          {isBaseline && <Badge variant="default">BASE</Badge>}
                          <span className="truncate">{name || `Result #${idStr}`}</span>
                          <Badge variant={isBaseline ? "default" : "outline"}>
                            {arc}/{mode}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="truncate">
                          {when} {name ? <span className="text-muted-foreground">· #{idStr}</span> : null}
                        </CardDescription>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => toggleResult(idStr)}
                          title="Remove from comparison"
                        >
                          <X className="mr-2 h-4 w-4" />
                          Remove from comparison
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {res ? (
                      showMaps ? (
                        <SimpleErrorBoundary>
                          <OptimizerResults
                            result={res}
                            sites={sites}
                            nameDisabled
                            vehicles={vehicles}
                            drivers={drivers}
                            /* force fresh MapContainer per card when selection changes */
                            mapkey={`cmp-${idStr}-${mapEpoch}`}
                          />
                        </SimpleErrorBoundary>
                      ) : (
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          <span>Map hidden</span>
                        </div>
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No result details saved for this item.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
