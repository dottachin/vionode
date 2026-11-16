/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSites } from "@/api/site";
import { fetchVehicles, fetchDrivers } from "@/api/vehicles";
import { optimizeRoutes } from "@/api/optimizer";
import { createMilkRun } from "@/api/milk_runs";
import {
  saveGlobalOptimization,
  fetchGlobalOptimizations,
  updateGlobalOptimization,
  deleteGlobalOptimization,
} from "@/api/optimizations";
import OptimizerResults from "@/components/optimizer/OptimizerResults";
import ResultSummary from "@/components/optimizer/ResultSummary";
import { sanitizeOptimizerInput, normalizeCategory } from "@/utils/sanitizeOptimizerInput";
import type { Site } from "@/types/site";
import type { Vehicle, Driver } from "@/types/vehicle";
import type {
  OptimizerInput,
  OptimizerResult,
  Metrics,
  OptimizationParams,
  GlobalOptimizationCreate,
  GlobalOptimizationRecord,
} from "@/types/optimizer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import {
  Warehouse,
  Truck,
  SlidersHorizontal,
  Rocket,
  Loader2,
  Plus,
  Check,
  FolderOpen,
} from "lucide-react";
import { TempSiteDialog } from "@/components/sites/TempSiteDialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "rizzui/badge";
import { Button as RButton } from "rizzui/button";
import { Input as RInput } from "rizzui/input";
import { Select as RSelect } from "rizzui/select";
import { Text } from "rizzui/text";
import { Title } from "rizzui/title";

type Arc = "distance" | "co2" | "duration";
type Solver = "balanced" | "fast" | "optimal";

// Country detection now prefers GPS coordinates on the site object (lat/lng),
// falling back to text fields if needed.
const countryCodeOf = (s: any) => {
  const lat = Number(s?.coordinates?.latitude);
  const lng = Number(s?.coordinates?.longitude);

  const inBox = (minLat: number, maxLat: number, minLng: number, maxLng: number) =>
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= minLat &&
    lat <= maxLat &&
    lng >= minLng &&
    lng <= maxLng;

  // Rough bounding boxes for the supported countries
  if (inBox(41.0, 51.7, -5.7, 9.9)) return "FRANCE";
  if (inBox(35.5, 43.9, -9.6, 3.5)) return "ESPAGNE";
  if (inBox(36.8, 42.3, -9.6, -6.0)) return "PORTUGAL";
  if (inBox(36.6, 47.3, 6.5, 19.0)) return "ITALIE";
  if (inBox(43.6, 48.4, 20.1, 29.8)) return "ROUMANIE";

  // Fallback to text-based country fields if GPS is missing/outside bounds
  const raw =
    s?.country?.code ??
    s?.country_code ??
    s?.country ??
    s?.address_country ??
    s?.city_country ??
    s?.address ??
    "";
  const str = String(raw || "").trim();
  if (!str) return "";

  // Extract from address: take last token after comma
  const parts = str.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || str;
  const normalized = last.toUpperCase();

  const map: Record<string, string> = {
    FRANCE: "FRANCE",
    ESPAGNE: "ESPAGNE",
    SPAIN: "ESPAGNE",
    PORTUGAL: "PORTUGAL",
    ITALIE: "ITALIE",
    ITALY: "ITALIE",
    ROUMANIE: "ROUMANIE",
    ROMANIA: "ROUMANIE",
  };

  return map[normalized] || normalized;
};

const toSiteInput = (s: Site, categoryOverride?: string) => ({
  id: String(s.id),
  name: String(s.name),
  address: s.address ?? "",
  coordinates: {
    latitude: Number(s.coordinates?.latitude ?? 0),
    longitude: Number(s.coordinates?.longitude ?? 0),
  },
  category: categoryOverride ?? normalizeCategory(s.category),
  service_time: Number(s.service_time ?? 0),
  operational_hours: {
    start: s.operational_hours?.start ?? "00:00",
    end: s.operational_hours?.end ?? "23:59",
  },
});

export default function OptimizationGlobal() {
  const [sites, setSites] = useState<Site[]>([]);
  const [tempSites, setTempSites] = useState<Site[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);

  const [selectedDepotIds, setSelectedDepotIds] = useState<string[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);

  const [arc, setArc] = useState<Arc>("distance");
  const [solver, setSolver] = useState<Solver>("balanced");
  const [slackMinutes, setSlackMinutes] = useState<number>(0);
  const [fixedCostPerRoute, setFixedCostPerRoute] = useState<number>(0);
  const [countryFilter, setCountryFilter] = useState<string>("");

  const [depotOpen, setDepotOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [depotQuery, setDepotQuery] = useState("");
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [siteQuery, setSiteQuery] = useState("");

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [savingRouteId, setSavingRouteId] = useState<string | null>(null);
  const [savingOptimization, setSavingOptimization] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const runTimerRef = useRef<number | null>(null);
  const [lastMetrics, setLastMetrics] = useState<Metrics | null>(null);
  const [lastResult, setLastResult] = useState<OptimizerResult | null>(null);
  const [lastDepotIds, setLastDepotIds] = useState<string[] | null>(null);
  const [lastSiteIds, setLastSiteIds] = useState<string[] | null>(null);
  const [lastVehicleIds, setLastVehicleIds] = useState<string[] | null>(null);
  const [lastParams, setLastParams] = useState<OptimizationParams | null>(null);
  const [lastHasTempSites, setLastHasTempSites] = useState(false);
  const [lastSolverRunId, setLastSolverRunId] = useState<string | null>(null);
  const [lastResultId, setLastResultId] = useState<string | null>(null);

  const [savedConfigs, setSavedConfigs] = useState<GlobalOptimizationRecord[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);

  const allSites = useMemo(() => [...sites, ...tempSites], [sites, tempSites]);

  useEffect(() => {
    (async () => {
      try {
        const [s, rawV, d] = await Promise.all([fetchSites(), fetchVehicles(), fetchDrivers()]);
        const normalizedVehicles = (rawV as any[]).map((veh) => ({
          ...veh,
          id: String(veh?.id ?? veh?.vehicle_id ?? ""),
          depot_id: veh?.depot_id ?? veh?.depotId ?? null,
        })) as Vehicle[];

        setSites(s);
        setVehicles(normalizedVehicles);
        setDrivers(d);
        const defaultDepots = s.filter((site) => normalizeCategory(site.category) === "depot").map((site) => site.id);
        setSelectedDepotIds(defaultDepots.slice(0, 1).map((id) => String(id)));
        setSelectedVehicleIds(normalizedVehicles.map((veh: any) => veh.id));
      } catch (e) {
        console.error(e);
        toast.error("Loading failed", { description: "Could not load sites, vehicles or drivers." });
      }
    })();
  }, []);

  const siteMap = useMemo(() => {
    const m = new Map<string, Site>();
    for (const s of allSites) m.set(String(s.id), s);
    return m;
  }, [allSites]);

  const depots = useMemo(
    () =>
      allSites.filter((s) => {
        const isDepot = normalizeCategory(s.category) === "depot";
        if (!isDepot) return false;
        if (!countryFilter) return true;
        return countryCodeOf(s) === countryFilter;
      }),
    [allSites, countryFilter]
  );
  const clientSites = useMemo(
    () =>
      allSites.filter((s) => {
        const isClient = normalizeCategory(s.category) !== "depot";
        if (!isClient) return false;
        if (!countryFilter) return true;
        return countryCodeOf(s) === countryFilter;
      }),
    [allSites, countryFilter]
  );

  const countryOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const s of allSites) {
      const c = countryCodeOf(s);
      if (c) codes.add(c);
    }
    const sorted = Array.from(codes).sort();
    return [{ value: "", label: "All countries" }, ...sorted.map((c) => ({ value: c, label: c }))];
  }, [allSites]);

  const filteredDepots = useMemo(() => {
    const q = depotQuery.trim().toLowerCase();
    if (!q) return depots;
    return depots.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        String(d.id).toLowerCase().includes(q) ||
        (d.address ?? "").toLowerCase().includes(q)
    );
  }, [depots, depotQuery]);

  const filteredVehicles = useMemo(() => {
    const q = vehicleQuery.trim().toLowerCase();
    let base = vehicles;
    if (countryFilter) {
      const allowedDepots = new Set(depots.map((d) => String(d.id)));
      base = base.filter((v) => !v.depot_id || allowedDepots.has(String(v.depot_id)));
    }
    if (!q) return base;
    return base.filter((v) => {
      const label = String((v as any).label ?? v.id ?? "").toLowerCase();
      const depotLabel = v.depot_id ? siteMap.get(String(v.depot_id))?.name ?? String(v.depot_id) : "";
      return (
        label.includes(q) ||
        String(v.id).toLowerCase().includes(q) ||
        depotLabel.toLowerCase().includes(q) ||
        (v.type ?? "").toLowerCase().includes(q)
      );
    });
  }, [siteMap, vehicleQuery, vehicles]);

  const filteredClientSites = useMemo(() => {
    const q = siteQuery.trim().toLowerCase();
    if (!q) return clientSites;
    return clientSites.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        String(s.id).toLowerCase().includes(q) ||
        (s.address ?? "").toLowerCase().includes(q)
    );
  }, [clientSites, siteQuery]);

  const toggleIdInList = (value: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  const selectionStats = useMemo(
    () => [
      { label: "Depots", value: selectedDepotIds.length, total: depots.length },
      { label: "Sites", value: selectedSiteIds.length, total: clientSites.length },
      { label: "Vehicles", value: selectedVehicleIds.length, total: vehicles.length },
    ],
    [clientSites.length, depots.length, selectedDepotIds.length, selectedSiteIds.length, selectedVehicleIds.length, vehicles.length]
  );

  const preflightIssues = useMemo(() => {
    const issues: string[] = [];
    if (!selectedDepotIds.length) issues.push("Select at least one depot");
    if (!selectedSiteIds.length) issues.push("Select at least one delivery site");
    if (!selectedVehicleIds.length) issues.push("Select at least one vehicle");
    return issues;
  }, [selectedDepotIds.length, selectedSiteIds.length, selectedVehicleIds.length]);

  const hasTempSites = tempSites.length > 0;

  const selectAllDepots = () => setSelectedDepotIds(depots.map((d) => String(d.id)));
  const selectAllSites = () => setSelectedSiteIds(clientSites.map((s) => String(s.id)));
  const selectAllVehicles = () => setSelectedVehicleIds(vehicles.map((v) => v.id));
  const selectAllDepotsInCountry = () => {
    if (!countryFilter) {
      selectAllDepots();
      return;
    }
    const ids = depots.map((d) => String(d.id));
    setSelectedDepotIds(ids);
  };
  const selectAllSitesInCountry = () => {
    if (!countryFilter) {
      selectAllSites();
      return;
    }
    const ids = clientSites.map((s) => String(s.id));
    setSelectedSiteIds(ids);
  };
  const selectAllVehiclesInCountry = () => {
    if (!countryFilter) {
      selectAllVehicles();
      return;
    }
    const allowedDepots = new Set(depots.map((d) => String(d.id)));
    const ids = vehicles
      .filter((v) => !v.depot_id || allowedDepots.has(String(v.depot_id)))
      .map((v) => v.id);
    setSelectedVehicleIds(ids);
  };
  const clearSelections = () => {
    setSelectedDepotIds([]);
    setSelectedSiteIds([]);
    setSelectedVehicleIds([]);
  };
  const clearResult = () => {
    setResult(null);
    setLastMetrics(null);
    setLastResult(null);
    setLastDepotIds(null);
    setLastSiteIds(null);
    setLastVehicleIds(null);
    setLastParams(null);
    setLastHasTempSites(false);
    setLastSolverRunId(null);
    setLastResultId(null);
  };

  const refreshSavedConfigs = async () => {
    setSavedError(null);
    setSavedLoading(true);
    try {
      const rows = await fetchGlobalOptimizations();
      setSavedConfigs(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      console.error(e);
      setSavedError("Could not load configurations.");
      toast.error("Failed to load configurations");
    } finally {
      setSavedLoading(false);
    }
  };

  useEffect(() => {
    refreshSavedConfigs();
  }, []);

  useEffect(
    () => () => {
      stopRunTimer();
    },
    []
  );

  const startRunTimer = () => {
    setElapsedSec(0);
    if (runTimerRef.current) window.clearInterval(runTimerRef.current);
    runTimerRef.current = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
  };

  const stopRunTimer = () => {
    if (runTimerRef.current) {
      window.clearInterval(runTimerRef.current);
      runTimerRef.current = null;
    }
  };

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleRun = async () => {
    if (selectedDepotIds.length === 0) {
      toast.warning("Depot required", { description: "Select at least one depot before running." });
      return;
    }
    if (selectedSiteIds.length === 0) {
      toast.warning("Sites required", { description: "Select at least one delivery site." });
      return;
    }
    if (selectedVehicleIds.length === 0) {
      toast.warning("Vehicles required", { description: "Select at least one vehicle." });
      return;
    }

    const slackSeconds = Math.max(0, Math.round(slackMinutes)) * 60;
    const hasTempInSelection = [...selectedDepotIds, ...selectedSiteIds].some((id) => String(id).startsWith("temp-"));

    setLastMetrics(null);
    setLastResult(null);
    setLastDepotIds(null);
    setLastSiteIds(null);
    setLastVehicleIds(null);
    setLastParams(null);
    setLastHasTempSites(false);
    setLastSolverRunId(null);
    setLastResultId(null);

    const depotsInput = selectedDepotIds
      .map((id) => siteMap.get(id))
      .filter(Boolean)
      .map((s) => toSiteInput(s as Site, "depot"));

    const sitesInput = selectedSiteIds
      .map((sid) => siteMap.get(sid))
      .filter(Boolean)
      .map((s) => ({
        ...toSiteInput(s as Site, normalizeCategory((s as Site).category)),
        demand_surface: 0,
        demand_weight: 0,
      }));

    const selectedVehicles = vehicles.filter((v) => selectedVehicleIds.includes(v.id));

    const driverIds = new Set<string>();
    for (const v of selectedVehicles) (v.driver_ids || []).forEach((id) => driverIds.add(String(id)));
    let selectedDrivers = drivers.filter((d) => driverIds.has(String(d.id)));
    if (!selectedDrivers.length) selectedDrivers = drivers.slice();

    let input: OptimizerInput = sanitizeOptimizerInput({
      depots: depotsInput,
      vehicles: selectedVehicles.map((v) => ({ ...v, depot_id: (v as any).depot_id ?? null })),
      drivers: selectedDrivers,
      sites: sitesInput,
      orders: [],
      slack_time_seconds: slackSeconds,
      optimization_arc: arc,
      solver_mode: solver,
      fixed_cost_per_route: fixedCostPerRoute > 0 ? fixedCostPerRoute : undefined,
    });

    input = {
      ...input,
      vehicles: (input.vehicles || []).map((v: any) => ({
        ...v,
        depot_id: v.depot_id ?? null,
        max_distance_meters:
          v.max_distance_meters ??
          (typeof (v as any).max_distance === "number" && (v as any).max_distance > 0
            ? Math.round((v as any).max_distance * 1000)
            : undefined),
      })),
    };

    startRunTimer();
    setRunning(true);
    setResult(null);
    try {
      const res = await optimizeRoutes(input);
      const metrics = (res as any).metrics ?? res.result?.metrics ?? null;
      setResult(res.result);
      setLastMetrics((metrics as Metrics) ?? null);
      setLastResult(res.result ?? null);
      setLastDepotIds([...selectedDepotIds]);
      setLastSiteIds([...selectedSiteIds]);
      setLastVehicleIds([...selectedVehicleIds]);
      setLastParams({
        optimization_arc: arc,
        solver_mode: solver,
        slack_time_seconds: slackSeconds,
        fixed_cost_per_route: fixedCostPerRoute > 0 ? fixedCostPerRoute : undefined,
      });
      setLastHasTempSites(hasTempInSelection);
      setLastSolverRunId((res as any).solver_run_id ?? null);
      setLastResultId((res as any).result_id ?? null);
      toast.success("Optimization complete");
    } catch (e) {
      console.error(e);
      toast.error("Optimization failed");
    } finally {
      stopRunTimer();
      setRunning(false);
    }
  };

  const handleSaveOptimization = async (name: string) => {
    if (lastHasTempSites) {
      toast.error("Cannot save", { description: "Save the temporary sites first." });
      return;
    }
    if (!lastMetrics || !lastResult || !lastParams || !lastDepotIds?.length || !lastSiteIds?.length) {
      toast.error("Not enough data to save");
      return;
    }
    if (!lastVehicleIds?.length) {
      toast.error("No vehicles to save");
      return;
    }

    const payload: GlobalOptimizationCreate = {
      name: name?.trim() || null,
      depot_ids: [...lastDepotIds],
      site_ids: [...lastSiteIds],
      vehicle_ids: [...lastVehicleIds],
      params: lastParams,
      metrics: lastMetrics,
      result: lastResult,
      solver_run_id: lastSolverRunId,
      result_id: lastResultId,
      note: "optimized",
    };

    try {
      setSavingOptimization(true);
      await saveGlobalOptimization(payload);
      toast.success("Global optimization saved");
    } catch (e) {
      console.error(e);
      toast.error("Save failed", { description: "Check the backend API." });
    } finally {
      setSavingOptimization(false);
      stopRunTimer();
    }
    await refreshSavedConfigs();
  };

  const handleSaveConfiguration = async () => {
    if (selectedDepotIds.length === 0) {
      toast.warning("Depot required", { description: "Select at least one depot before saving." });
      return;
    }
    if (selectedVehicleIds.length === 0) {
      toast.warning("Vehicles required", { description: "Select at least one vehicle before saving." });
      return;
    }
    const slackSeconds = Math.max(0, Math.round(slackMinutes)) * 60;

    if ([...selectedDepotIds, ...selectedSiteIds].some((id) => String(id).startsWith("temp-"))) {
      toast.error("Temporary sites", { description: "Save the temporary sites before saving." });
      return;
    }

    const payload: GlobalOptimizationCreate = {
      name: `Configuration - ${arc}/${solver}`,
      depot_ids: [...selectedDepotIds],
      site_ids: [...selectedSiteIds],
      vehicle_ids: [...selectedVehicleIds],
      params: {
        optimization_arc: arc,
        solver_mode: solver,
        slack_time_seconds: slackSeconds,
        fixed_cost_per_route: fixedCostPerRoute > 0 ? fixedCostPerRoute : undefined,
      },
      metrics: {} as Metrics,
      result: null,
      solver_run_id: null,
      result_id: null,
      note: "draft",
    };

    try {
      setSavingConfig(true);
      await saveGlobalOptimization(payload);
      toast.success("Configuration saved", { description: "Parameters saved without running the optimization." });
    } catch (e) {
      console.error(e);
      toast.error("Failed to save configuration");
    } finally {
      setSavingConfig(false);
    }
    await refreshSavedConfigs();
  };

  const applySavedConfig = (cfg: GlobalOptimizationRecord) => {
    const depots = (cfg.depot_ids || []).map(String);
    const sites = (cfg.site_ids || []).map(String);
    const vehiclesIds = (cfg.vehicle_ids || []).map(String);
    const params = (cfg.params || {}) as OptimizationParams;

    setSelectedDepotIds(depots);
    setSelectedSiteIds(sites);
    setSelectedVehicleIds(vehiclesIds);

    if (params.optimization_arc) setArc(params.optimization_arc as Arc);
    if (params.solver_mode) setSolver(params.solver_mode as Solver);
    if (typeof params.slack_time_seconds === "number") {
      setSlackMinutes(Math.max(0, Math.round(params.slack_time_seconds / 60)));
    } else {
      setSlackMinutes(0);
    }
    if (typeof params.fixed_cost_per_route === "number") {
      setFixedCostPerRoute(params.fixed_cost_per_route);
    } else {
      setFixedCostPerRoute(0);
    }

    setLastDepotIds(depots);
    setLastSiteIds(sites);
    setLastVehicleIds(vehiclesIds);
    setLastParams({
      optimization_arc: params.optimization_arc as Arc,
      solver_mode: params.solver_mode as Solver,
      slack_time_seconds: params.slack_time_seconds ?? 0,
      fixed_cost_per_route: params.fixed_cost_per_route,
      site_vehicle_map: params.site_vehicle_map,
    });
    setLastMetrics((cfg.metrics as Metrics) ?? null);
    setLastResult((cfg.result as OptimizerResult) ?? null);
    setLastHasTempSites(false);
    setLastSolverRunId((cfg as any).solver_run_id ?? null);
    setLastResultId((cfg as any).result_id ?? null);

    setResult((cfg.result as OptimizerResult) ?? null);

    toast.success("Configuration loaded", {
      description: cfg.name || `#${cfg.id}`,
    });
  };

  const handleRenameConfig = async (cfg: GlobalOptimizationRecord) => {
    const next = window.prompt("New name", cfg.name || `Configuration #${cfg.id}`);
    if (next === null) return;
    try {
      await updateGlobalOptimization(cfg.id, { name: next.trim() || null });
      toast.success("Configuration renamed");
      await refreshSavedConfigs();
    } catch (e) {
      console.error(e);
      toast.error("Rename failed");
    }
  };

  const handleDeleteConfig = async (cfg: GlobalOptimizationRecord) => {
    const ok = window.confirm(`Delete "${cfg.name || cfg.id}"?`);
    if (!ok) return;
    try {
      await deleteGlobalOptimization(cfg.id);
      toast.success("Configuration deleted");
      await refreshSavedConfigs();
    } catch (e) {
      console.error(e);
      toast.error("Delete failed");
    }
  };

  const handleSaveMilkRunFromRoute = async (route: any) => {
    const vehId = String((route?.vehicle_id ?? "vehicule") || "");
    const depotId = String(route?.depot_id ?? selectedDepotIds[0] ?? "");

    if (!depotId) {
      toast.error("Missing depot", { description: "Could not determine the depot for this vehicle." });
      return;
    }

    const stops: any[] = Array.isArray(route?.stops) ? route.stops : [];
    const siteIds = Array.from(
      new Set(
        stops
          .map((s) => String(s?.site_id ?? ""))
          .filter((id) => id && id !== depotId && !id.includes("_virtual_"))
      )
    );

    if (!siteIds.length) {
      toast.warning("No sites to save", { description: "This route contains no client sites to save." });
      return;
    }

    if (siteIds.some((id) => id.startsWith("temp-"))) {
      toast.error("Temporary sites", { description: "Save the temporary sites before creating a route." });
      return;
    }

    const defaultName = `MR-${vehId}`;
    const name = window.prompt("Route name", defaultName);
    if (!name) return;

    try {
      setSavingRouteId(vehId);
      await createMilkRun({ name: name.trim(), site_ids: siteIds, depot_id: depotId });
      toast.success("Route created", { description: `${name.trim()} (${siteIds.length} sites)` });
    } catch (e) {
      console.error(e);
      toast.error("Could not create the route");
    } finally {
      setSavingRouteId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border shadow-lg ring-1 ring-black/5">
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Rocket className="h-5 w-5 text-blue-600" aria-hidden />
                Global route optimization
              </CardTitle>
              <CardDescription>Multi-depot, multi-vehicle optimization with solver controls.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(preflightIssues.length ? preflightIssues : ["Ready to run"]).map((item) => (
                <Badge key={item} color={preflightIssues.length ? "warning" : "success"} variant="flat">
                  {item}
                </Badge>
              ))}
              {hasTempSites ? (
                <Badge color="info" variant="outline">
                  {tempSites.length} site(s) temporaire(s)
                </Badge>
              ) : null}
              <Badge color="info" variant="flat">
                Arc : {arc}
              </Badge>
              <Badge color="info" variant="flat">
                Solveur : {solver}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <RButton
              variant="solid"
              size="md"
              className="min-w-[200px]"
              onClick={handleRun}
              disabled={running}
            >
              <div className="flex items-center gap-2">
                {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Rocket className="h-4 w-4" aria-hidden />}
                <span>{running ? `Optimizing (${formatElapsed(elapsedSec)})` : "Run optimization"}</span>
              </div>
            </RButton>
            <TempSiteDialog
              trigger={
                <RButton
                  variant="outline"
                  size="md"
                  className="inline-flex items-center gap-2 border-border/70 ring-1 ring-primary/20 shadow-sm"
                  aria-label="Add a temporary site"
                  title="Add a temporary site"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add a temporary site
                </RButton>
              }
              onCreate={(site) => setTempSites((prev) => [...prev, site])}
            />
            <RButton variant="text" size="md" onClick={clearResult}>
              Clear previous result
            </RButton>
            <RButton
              variant="outline"
              size="md"
              onClick={handleSaveConfiguration}
              disabled={savingConfig}
              className="inline-flex items-center gap-2"
            >
              {savingConfig ? "Saving..." : "Save configuration"}
            </RButton>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {selectionStats.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border/70 bg-muted/40 p-3">
                <Text className="text-xs uppercase tracking-wide text-text-secondary">{stat.label}</Text>
                <Title as="h4" fontWeight="semibold" className="text-lg">
                  {stat.value} / {stat.total}
                </Title>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RButton variant="flat" size="sm" onClick={selectAllDepots}>
              Use all depots
            </RButton>
            <RButton variant="flat" size="sm" onClick={selectAllSites}>
              Use all sites
            </RButton>
            <RButton variant="flat" size="sm" onClick={selectAllVehicles}>
              Use all vehicles
            </RButton>
            <RButton variant="text" size="sm" onClick={clearSelections}>
              Clear selections
            </RButton>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-blue-100/60 shadow-lg ring-1 ring-black/5">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-blue-600" aria-hidden />
            <div>
              <CardTitle className="text-lg">Saved configurations</CardTitle>
              <CardDescription>Reload or clean up your global configurations before running.</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {savedLoading ? "Loading..." : savedConfigs.length ? `${savedConfigs.length} item(s)` : "No configurations"}
            {savedError ? <span className="text-destructive">({savedError})</span> : null}
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-3">
          {savedConfigs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No saved configurations yet.</div>
          ) : (
            savedConfigs.slice(0, 10).map((cfg) => (
              <div
                key={cfg.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-3"
              >
                <div className="min-w-[220px]">
                  <div className="font-semibold">{cfg.name || `Configuration #${cfg.id}`}</div>
                  <div className="text-xs text-muted-foreground">
                    {cfg.created_at ? new Date(cfg.created_at).toLocaleString() : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {cfg.depot_ids?.length ?? 0} depots · {cfg.site_ids?.length ?? 0} sites · {cfg.vehicle_ids?.length ?? 0} vehicles
                  </div>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <RButton size="sm" variant="outline" onClick={() => applySavedConfig(cfg)}>
                    Load
                  </RButton>
                  <RButton size="sm" variant="outline" onClick={() => handleRenameConfig(cfg)}>
                    Rename
                  </RButton>
                  <RButton
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => handleDeleteConfig(cfg)}
                  >
                    Delete
                  </RButton>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border border-blue-100/60 shadow-lg ring-1 ring-black/5">
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Warehouse className="h-5 w-5 text-blue-600" aria-hidden />
              Selections
            </CardTitle>
            <CardDescription>Same search selectors as for Routes / Orders.</CardDescription>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[220px]">
              <Text className="text-sm font-semibold text-text-primary">Filter by country</Text>
              <RSelect
                options={countryOptions}
                value={countryFilter}
                onChange={(value) => setCountryFilter(String(value))}
                placeholder="All countries"
                size="md"
                getOptionValueKey="value"
              />
            </div>
            <RButton variant="flat" size="sm" onClick={selectAllDepotsInCountry}>
              Select all depots in country
            </RButton>
            <RButton variant="flat" size="sm" onClick={selectAllSitesInCountry}>
              Select all sites in country
            </RButton>
            <RButton variant="flat" size="sm" onClick={selectAllVehiclesInCountry}>
              Select all vehicles in country
            </RButton>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Text className="text-sm font-semibold text-text-primary">Depots</Text>
              <Popover open={depotOpen} onOpenChange={setDepotOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                    <span>{selectedDepotIds.length ? `${selectedDepotIds.length} selected` : "Select depots"}</span>
                    <Warehouse className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0 max-h-[420px] overflow-hidden" align="start">
                  <Command>
                    <CommandInput value={depotQuery} onValueChange={setDepotQuery} placeholder="Search depots..." />
                    <CommandList>
                      <CommandEmpty>No depots found.</CommandEmpty>
                      <CommandGroup>
                        {filteredDepots.map((d) => {
                            const selected = selectedDepotIds.includes(String(d.id));
                            return (
                              <CommandItem
                                key={d.id}
                                onSelect={() =>
                                  setSelectedDepotIds((prev) =>
                                    prev.includes(String(d.id))
                                      ? prev.filter((x) => x !== String(d.id))
                                      : [...prev, String(d.id)]
                                  )
                                }
                                className="gap-2"
                              >
                                <Check className={`h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden />
                                <div className="flex flex-col">
                                  <span className="font-medium">{d.name}</span>
                                  <span className="text-xs text-muted-foreground">{d.address ?? "No address"}</span>
                                </div>
                              </CommandItem>
                            );
                          })}
                        
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <div className="flex flex-wrap gap-2">
                {selectedDepotIds.length === 0 ? (
                  <Text className="text-xs text-text-secondary">No depot selected.</Text>
                ) : (
                  selectedDepotIds.map((id) => {
                    const depot = siteMap.get(id);
                    return (
                      <Badge
                        key={id}
                        color="info"
                        variant="flat"
                        className="border border-blue-300 ring-2 ring-blue-200/80 shadow-md font-semibold text-sm px-3 py-1.5 bg-blue-50/80"
                      >
                        {depot?.name ?? id}
                      </Badge>
                    );
                  })
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Text className="text-sm font-semibold text-text-primary">Vehicles (with depot)</Text>
              <Popover open={vehicleOpen} onOpenChange={setVehicleOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                    <span>{selectedVehicleIds.length ? `${selectedVehicleIds.length} selected` : "Select vehicles"}</span>
                    <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0 max-h-[420px] overflow-hidden" align="start">
                  <Command>
                    <CommandInput value={vehicleQuery} onValueChange={setVehicleQuery} placeholder="Search vehicles..." />
                    <CommandList>
                      <CommandEmpty>No vehicles found.</CommandEmpty>
                      <CommandGroup>
                        {filteredVehicles.map((v) => {
                            const depotLabel = v.depot_id
                              ? siteMap.get(String(v.depot_id))?.name ?? String(v.depot_id)
                              : "No depot";
                            const label = (v as any).label || v.id;
                            const selected = selectedVehicleIds.includes(v.id);
                            return (
                              <CommandItem
                                key={v.id}
                                onSelect={() => toggleIdInList(v.id, selectedVehicleIds, setSelectedVehicleIds)}
                                className="gap-2"
                              >
                                <Check className={`h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden />
                                <div className="flex flex-col">
                                  <span className="font-medium">
                                    {label} <span className="text-xs text-muted-foreground">({depotLabel})</span>
                                  </span>
                                  <span className="text-xs text-muted-foreground">{v.type ?? "-"}</span>
                                </div>
                              </CommandItem>
                            );
                          })}
                        
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <div className="flex flex-wrap gap-2">
                {selectedVehicleIds.length === 0 ? (
                  <Text className="text-xs text-text-secondary">No vehicle selected.</Text>
                ) : (
                  selectedVehicleIds.map((id) => {
                    const veh = vehicles.find((v) => v.id === id);
                    const depotLabel = veh?.depot_id
                      ? siteMap.get(String(veh.depot_id))?.name ?? String(veh.depot_id)
                      : "No depot";
                    return (
                      <Badge
                        key={id}
                        color="info"
                        variant="flat"
                        className="border border-blue-300 ring-2 ring-blue-200/80 shadow-md font-semibold text-sm px-3 py-1.5 bg-blue-50/80"
                      >
                        {(veh as any)?.label || id} ({depotLabel})
                      </Badge>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Text className="text-sm font-semibold text-text-primary">Delivery sites</Text>
            <Popover open={siteOpen} onOpenChange={setSiteOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span>{selectedSiteIds.length ? `${selectedSiteIds.length} selected` : "Select sites"}</span>
                  <Warehouse className="h-4 w-4 text-muted-foreground" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[420px] p-0 max-h-[520px] overflow-hidden" align="start">
                <Command>
                  <CommandInput value={siteQuery} onValueChange={setSiteQuery} placeholder="Search sites..." />
                  <CommandList>
                    <CommandEmpty>No sites found.</CommandEmpty>
                    <CommandGroup>
                        {filteredClientSites.map((s) => {
                          const selected = selectedSiteIds.includes(String(s.id));
                          return (
                            <CommandItem
                              key={s.id}
                              onSelect={() => toggleIdInList(String(s.id), selectedSiteIds, setSelectedSiteIds)}
                              className="gap-2"
                            >
                              <Check className={`h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden />
                              <div className="flex flex-col">
                                <span className="font-medium">{s.name}</span>
                                <span className="text-xs text-muted-foreground">{s.address ?? "No address"}</span>
                              </div>
                            </CommandItem>
                          );
                        })}
                      
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <div className="flex flex-wrap gap-2">
              {selectedSiteIds.length === 0 ? (
                <Text className="text-xs text-text-secondary">No site selected.</Text>
              ) : (
                selectedSiteIds.slice(0, 16).map((id) => {
                  const site = siteMap.get(id);
                  return (
                    <Badge
                      key={id}
                      color="info"
                      variant="flat"
                      className="border border-blue-300 ring-2 ring-blue-200/80 shadow-md font-semibold text-sm px-3 py-1.5 bg-blue-50/80"
                    >
                      {site?.name ?? id}
                    </Badge>
                  );
                })
              )}
                {selectedSiteIds.length > 16 ? (
                <Badge
                  color="info"
                  variant="outline"
                  className="border border-blue-300 ring-2 ring-blue-200/80 shadow-md font-semibold text-sm px-3 py-1.5 bg-blue-50/70"
                >
                  +{selectedSiteIds.length - 16} de plus
                </Badge>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-blue-100/80 shadow-lg ring-1 ring-black/5">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <SlidersHorizontal className="h-5 w-5 text-blue-600" aria-hidden />
                Optimization parameters
              </CardTitle>
              <CardDescription>Choose the objective and mode, then adjust tolerance and cost.</CardDescription>
            </div>
            <Badge color={preflightIssues.length ? "warning" : "success"} variant="flat">
              {preflightIssues.length ? `${preflightIssues.length} check(s) pending` : "Ready to run"}
            </Badge>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Text className="text-xs font-semibold uppercase text-text-secondary">Optimization objective</Text>
              <RSelect
                options={[
                  { value: "distance", label: "Distance min" },
                  { value: "duration", label: "Temps min" },
                  { value: "co2", label: "CO₂ min" },
                ]}
                value={arc}
                onChange={(value) => setArc(String(value) as Arc)}
                placeholder="Choose"
                size="md"
                getOptionValueKey="value"
              />
              <Text className="text-xs text-text-secondary">Select what the solver should minimize first.</Text>
            </div>
            <div className="space-y-2">
              <Text className="text-xs font-semibold uppercase text-text-secondary">Solver mode</Text>
              <RSelect
                options={[
                  { value: "balanced", label: "Balanced" },
                  { value: "fast", label: "Fast" },
                  { value: "optimal", label: "Optimal" },
                ]}
                value={solver}
                onChange={(value) => setSolver(String(value) as Solver)}
                placeholder="Choose"
                size="md"
                getOptionValueKey="value"
              />
              <Text className="text-xs text-text-secondary">Balanced keeps a quality/speed trade-off suited to daily use.</Text>
            </div>
            <div className="space-y-2">
              <Text className="text-xs font-semibold uppercase text-text-secondary">Tolerance (minutes)</Text>
              <RInput
                type="number"
                min={0}
                value={slackMinutes}
                onChange={(event) => setSlackMinutes(Math.max(0, Number(event.target.value) || 0))}
                suffix={<Text className="text-xs text-text-secondary">min</Text>}
              />
              <Text className="text-xs text-text-secondary">Buffer time per stop to absorb real-world delays.</Text>
            </div>
            <div className="space-y-2">
              <Text className="text-xs font-semibold uppercase text-text-secondary">Fixed cost per route</Text>
              <RInput
                type="number"
                min={0}
                value={fixedCostPerRoute}
                onChange={(event) => setFixedCostPerRoute(Math.max(0, Number(event.target.value) || 0))}
                suffix={<Text className="text-xs text-text-secondary">per route</Text>}
              />
              <Text className="text-xs text-text-secondary">Use it to avoid excessive route fragmentation.</Text>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-blue-50/70 p-4 shadow-inner dark:bg-blue-950/30">
            <div className="flex flex-col gap-1">
              <Text className="text-sm font-semibold text-blue-900 dark:text-blue-100">Checks</Text>
              <Text className="text-xs text-blue-900/80 dark:text-blue-100/80">
                {preflightIssues.length
                  ? preflightIssues[0]
                  : "Drivers are inferred automatically from vehicles; defaults are applied when missing."}
              </Text>
            </div>
              <RButton
                variant="solid"
                size="md"
                className="ml-auto min-w-[200px]"
                onClick={handleRun}
                disabled={running}
              >
                <div className="flex items-center gap-2">
                  {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Rocket className="h-4 w-4" aria-hidden />}
                  <span>{running ? `Optimizing (${formatElapsed(elapsedSec)})` : "Run optimization"}</span>
                </div>
              </RButton>
            </div>
        </CardContent>
      </Card>

      {result && (
        <ResultSummary result={result} title="Summary" description="Quick view of key metrics." />
      )}

      {result && (
        <>
            <OptimizerResults
            result={result}
            sites={allSites}
            vehicles={vehicles}
            drivers={drivers}
            saving={savingOptimization}
            onSave={handleSaveOptimization}
              defaultName={`Global optimization - ${lastParams?.optimization_arc ?? arc}/${lastParams?.solver_mode ?? solver}`}
          />

          {Array.isArray(result.routes) && result.routes.length > 0 && (
            <Card className="border border-blue-100/60 shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Truck className="h-5 w-5 text-blue-600" aria-hidden />
                    Save a reusable route
                  </CardTitle>
                  <CardDescription>Turn each vehicle route into a reusable route (depot + sites).</CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="space-y-3">
                {result.routes.map((route: any) => {
                  const vehId = String(route?.vehicle_id ?? "");
                  const depotId = String(route?.depot_id ?? selectedDepotIds[0] ?? "");
                  const depotLabel = depotId ? siteMap.get(depotId)?.name ?? depotId : "-";
                  const used = route?.used !== false;
                  return (
                    <div
                      key={`${vehId}-${depotId}`}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-border/80 bg-muted/30 p-3"
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="font-semibold">Vehicle {vehId || "-"}</div>
                        <div className="text-sm text-muted-foreground">Depot: {depotLabel}</div>
                        <div className="text-xs text-muted-foreground">{used ? "Used in the solution" : "Marked as unused"}</div>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <RButton
                          variant="solid"
                          size="sm"
                          disabled={!used || savingRouteId === vehId}
                          isLoading={savingRouteId === vehId}
                          loader={<Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                          onClick={() => handleSaveMilkRunFromRoute(route)}
                        >
                          {savingRouteId === vehId ? "Saving…" : "Save as route"}
                        </RButton>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
