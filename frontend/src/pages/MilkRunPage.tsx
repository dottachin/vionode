/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Site } from "@/types/site";
import { fetchSites } from "@/api/site";
import { fetchVehicles, fetchDrivers } from "@/api/vehicles";
import MilkRunEditor from "@/components/optimizer/MilkRunEditor";
import { optimizeRoutes, scoreManualRoute } from "@/api/optimizer";
import { generateOptimizerInputFromMilkRun } from "@/utils/generateOptimizerInputFromMilkRun";
import OptimizerResults from "@/components/optimizer/OptimizerResults";
import SpinnerWithText from "@/components/ui/SpinnerWithText";
import { TempSiteDialog } from "@/components/sites/TempSiteDialog";

import type { OptimizerResult, OptimizerInput, Metrics } from "@/types/optimizer";
import type { Driver, Vehicle } from "@/types/vehicle";
import type { MilkRun } from "@/types/milk_run";
import type { OptimizationCreate, OptimizationRecord } from "@/types/optimizer";
import {
  saveOptimization,
  fetchOptimizationsByMilkRun,
  deleteOptimization,
  // removed fetchLastManualByMilkRun (no auto-load of last manual)
} from "@/api/optimizations";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Route as RouteIcon, Gauge, Rocket, Trash2, SlidersHorizontal, Save, RotateCcw, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { sanitizeOptimizerInput } from "@/utils/sanitizeOptimizerInput";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

/* ---------------------------------- Types --------------------------------- */
type Arc = "distance" | "co2" | "duration";
type Solver = "balanced" | "fast" | "optimal";

// Match backend MODE_CONFIG timeouts (seconds)
const MODE_EXPECTED_SECONDS: Record<Solver, number> = {
  fast: 20,
  balanced: 120,
  optimal: 300,
};

/** -------------------- SCALING -------------------- */
const SURFACE_SCALE_FACTOR = Number(import.meta.env.VITE_SURFACE_SCALE_FACTOR ?? 100);
const WEIGHT_SCALE_FACTOR = Number(import.meta.env.VITE_WEIGHT_SCALE_FACTOR ?? 100);
const scaleSurface = (x: unknown) => Math.round((Number(x) || 0) * SURFACE_SCALE_FACTOR);
const scaleWeight = (x: unknown) => Math.round((Number(x) || 0) * WEIGHT_SCALE_FACTOR);
/** ------------------------------------------------ */

/** convert km → meters (skip invalid/zero/negative) */
const toMetersFromKm = (km: unknown) => {
  const n = Number(km);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : undefined;
};

/** vehicle id helper (robust across shapes) */
const vehicleIdOf = (v: any) => String(v?.id ?? v?.vehicle_id ?? v ?? "");

/** shallow equality helpers */
function shallowEqualArr(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return false;
}
function shallowEqualMap(a: Record<string, string>, b: Record<string, string>) {
  if (a === b) return true;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

export default function MilkRunPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [tempSites, setTempSites] = useState<Site[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);

  const [depotId, setDepotId] = useState("");
  const [siteIds, setSiteIds] = useState<string[]>([]);

  // Vehicle selection (UX primary)
  const [, setSelectedVehicleId] = useState<string>("");

  // Multi-vehicle selection
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);

  // per-site vehicle assignment map: { [siteId]: vehicleId }
  const [siteVehicleMap, setSiteVehicleMap] = useState<Record<string, string>>({});

  // Results
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [, setMetrics] = useState<Metrics | null>(null);

  // Manual result + metrics (to render via OptimizerResults)
  const [manualResult, setManualResult] = useState<OptimizerResult | null>(null);
  const [, setManualMetrics] = useState<Metrics | null>(null);

  // ▶ Selected history record for preview
  const [selectedHistory, setSelectedHistory] = useState<OptimizationRecord | null>(null);
  const historyPreviewRef = useRef<HTMLDivElement | null>(null);

  // Optimizer progress & state
  const [loading, setLoading] = useState(false);
  const [optProgressPct, setOptProgressPct] = useState(0);
  const [optElapsedSec, setOptElapsedSec] = useState(0);
  const [optMode, setOptMode] = useState<Solver>("balanced");
  const optTimerRef = useRef<number | null>(null);
  const optStartRef = useRef<number | null>(null);

  // Manual scoring progress & state
  const [scoring, setScoring] = useState(false);
  const [manualProgressPct, setManualProgressPct] = useState(0);
  const [manualElapsedSec, setManualElapsedSec] = useState(0);
  const [manualMode, setManualMode] = useState<Solver>("balanced");
  const manualTimerRef = useRef<number | null>(null);
  const manualStartRef = useRef<number | null>(null);

  const [savingOptimized, setSavingOptimized] = useState(false);

  // Strategy & solver
  const [optimizationArc, setOptimizationArc] = useState<Arc>("duration");
  const [solverMode, setSolverMode] = useState<Solver>("balanced");
  const [slackMinutes, setSlackMinutes] = useState<number>(0);

  // milk run selection + history
  const [selectedRun, setSelectedRun] = useState<MilkRun | null>(null);
  const [history, setHistory] = useState<OptimizationRecord[]>([]);
  const selectedRunId = selectedRun?.id ?? "";

  // delete state for history
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // store last optimized data for explicit save
  const [lastOptimMetrics, setLastOptimMetrics] = useState<Metrics | null>(null);
  const [lastOptimResult, setLastOptimResult] = useState<OptimizerResult | null>(null);

  // Force fresh map instances when shown results change
  const [mapEpoch, setMapEpoch] = useState(0);
  useEffect(() => {
    setMapEpoch((e: number) => e + 1);
  }, [manualResult, result, selectedHistory]);

  const allSites = useMemo(() => [...sites, ...tempSites], [sites, tempSites]);

  useEffect(() => {
    (async () => {
      try {
        const [sitesRes, vehiclesRes, driversRes] = await Promise.all([
          fetchSites(),
          fetchVehicles(),
          fetchDrivers(),
        ]);

        setSites(sitesRes);

        // Normalize vehicle IDs to string once here
        const normalizedVehicles = (vehiclesRes as any[]).map((v) => ({
          ...v,
          id: String(v.id ?? v.vehicle_id),
        }));
        setVehicles(normalizedVehicles as Vehicle[]);

        setDrivers(driversRes);
      } catch (e) {
        console.error(e);
        toast.error("Loading error", {
          description: "Could not fetch sites, vehicles or drivers.",
        });
      }
    })();
  }, []);

  // Load history whenever the selected milk run changes
  useEffect(() => {
    if (!selectedRunId) {
      setHistory([]);
      setManualResult(null);
      setSelectedHistory(null);
      return;
    }
    fetchOptimizationsByMilkRun(String(selectedRunId))
      .then((rows) => {
        const sorted = (rows || []).slice().sort(
          (a: any, b: any) =>
            new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
        );
        setHistory(sorted);
      })
      .catch((e: any) => {
        console.error(e);
        toast.error("History unavailable", {
          description: "Could not fetch optimizations.",
        });
      });
  }, [selectedRunId]);

  // 🚫 Removed: auto-fetch of last manual result (kept only on-demand via button)

  // Autofill from latest saved optimization
  const hydratedOnceRef = useRef(false);
  useEffect(() => {
    if (hydratedOnceRef.current) return;
    if (!history.length) return;

    const latest = history[0];
    if (!latest) return;

    const willSetDepot = !depotId && (latest as any).depot_id;
    const willSetSites = !siteIds.length && Array.isArray((latest as any).site_ids) && (latest as any).site_ids.length > 0;
    const willSetVehs =
      !selectedVehicleIds.length && Array.isArray((latest as any).vehicle_ids) && (latest as any).vehicle_ids.length > 0;
    const savedMap = (latest as any)?.params?.site_vehicle_map || {};
    const willSetMap = Object.keys(siteVehicleMap).length === 0 && Object.keys(savedMap).length > 0;

    if (willSetDepot) setDepotId(String((latest as any).depot_id));
    if (willSetSites) setSiteIds((latest as any).site_ids.map(String));
    if (willSetVehs) setSelectedVehicleIds((latest as any).vehicle_ids.map(String));
    if (willSetMap) setSiteVehicleMap(savedMap);

    if (willSetDepot || willSetSites || willSetVehs || willSetMap) {
      hydratedOnceRef.current = true;
    }
  }, [history]); // eslint-disable-line react-hooks/exhaustive-deps

  const siteMap = useMemo(() => {
    const m: Record<string, Site> = {};
    for (const s of allSites) m[s.id] = s;
    return m;
  }, [allSites]);

  const depot = useMemo(
    () => allSites.find((s: { id: any }) => s.id === depotId),
    [allSites, depotId]
  );

  // ------- Progress helpers
  const startOptProgress = (mode: Solver) => {
    clearOptProgress();
    setOptMode(mode);
    setOptProgressPct(0);
    setOptElapsedSec(0);
    const start = Date.now();
    optStartRef.current = start;
    const expected = MODE_EXPECTED_SECONDS[mode];

    optTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      setOptElapsedSec(elapsed);
      const pct = Math.min(99, Math.floor((elapsed / expected) * 100));
      setOptProgressPct(pct);
    }, 200);
  };

  const clearOptProgress = () => {
    if (optTimerRef.current) {
      window.clearInterval(optTimerRef.current);
      optTimerRef.current = null;
    }
    optStartRef.current = null;
  };

  const startManualProgress = (mode: Solver) => {
    clearManualProgress();
    setManualMode(mode);
    setManualProgressPct(0);
    setManualElapsedSec(0);
    const start = Date.now();
    manualStartRef.current = start;
    const expected = MODE_EXPECTED_SECONDS[mode];

    manualTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      setManualElapsedSec(elapsed);
      const pct = Math.min(99, Math.floor((elapsed / expected) * 100));
      setManualProgressPct(pct);
    }, 200);
  };

  const clearManualProgress = () => {
    if (manualTimerRef.current) {
      window.clearInterval(manualTimerRef.current);
      manualTimerRef.current = null;
    }
    manualStartRef.current = null;
  };

  useEffect(() => () => { clearOptProgress(); clearManualProgress(); }, []);

  // Helpers to annotate orders with vehicle IDs (manual only)
  function annotateOrdersWithVehicles(input: OptimizerInput, perSite: Record<string, string>): OptimizerInput {
    const orders = (input as any).orders as any[] | undefined;
    if (!Array.isArray(orders)) return input;

    (input as any).orders = orders.map((o: any) => {
      const destId = String(o?.destination?.id ?? o?.destination_id ?? "");
      const vid = perSite[destId];
      if (vid) {
        const svid = String(vid);
        o.assigned_vehicle_id = svid;
        o.vehicle_id = svid;
        o.vehicule_id = svid;
        o.metadata = { ...(o.metadata || {}), vehicle_id: svid };
      }
      return o;
    });
    return input;
  }

  /** Vehicles for OPTIMIZATION: from selectedVehicleIds ONLY */
  const optVehicleIds = useMemo(
    () => selectedVehicleIds.map(String),
    [selectedVehicleIds]
  );
  const optVehicles = useMemo(() => {
    if (!optVehicleIds.length) return [] as Vehicle[];
    const set = new Set(optVehicleIds);
    return vehicles.filter((v: any) => set.has(String((v as any).id ?? v)));
  }, [vehicles, optVehicleIds]);

  /** Vehicles for MANUAL: from per-site mapping ONLY */
  const manualVehicleIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values(siteVehicleMap).forEach((vid) => {
      const s = String(vid ?? "");
      if (s) ids.add(s);
    });
    return Array.from(ids);
  }, [siteVehicleMap]);

  const manualVehicles = useMemo(() => {
    if (!manualVehicleIds.length) return [] as Vehicle[];
    const set = new Set(manualVehicleIds);
    return vehicles.filter((v: any) => set.has(String((v as any).id ?? v)));
  }, [vehicles, manualVehicleIds]);

  const buildRawById = (list: Vehicle[]) => {
    const m = new Map<string, any>();
    for (const v of list as any[]) m.set(vehicleIdOf(v), v);
    return m;
  };

  // --- Manual scoring & save ---
  const scoreAndSaveManual = async () => {
    if (!selectedRunId || !selectedRun) {
      toast.info("Select or create a milk run first to save the manual route.");
      return;
    }
    if (!depotId || siteIds.length === 0 || !depot) {
      toast.warning("Depot and sites required", { description: "Select a depot and at least one site.", });
      return;
    }
    if (!manualVehicles.length) {
      toast.warning("Vehicle required", { description: "Assign at least one vehicle (via the per-site assignment card).", });
      return;
    }

    setScoring(true);
    setManualResult(null);
    setManualMetrics(null);
    startManualProgress(solverMode);

    try {
      const baseInput: OptimizerInput = generateOptimizerInputFromMilkRun(
        depot,
        siteIds,
        siteMap,
        manualVehicles,
        drivers
      );

      // minutes -> seconds
      let input: OptimizerInput = sanitizeOptimizerInput({
        ...baseInput,
        optimization_arc: optimizationArc,
        solver_mode: solverMode,
        slack_time_seconds: Math.max(0, Math.round(slackMinutes)) * 60,
      });

      input.vehicles = (input.vehicles?.length ? input.vehicles : manualVehicles) as any;
      (input as any).vehicle_ids = manualVehicleIds.map(String);

      input = annotateOrdersWithVehicles(input, siteVehicleMap);

      input = {
        ...input,
        vehicles: (input.vehicles || []).map((v: any) => ({
          ...v,
          surface: scaleSurface(v.surface),
          weight: scaleWeight(v.weight),
          depot_id: undefined,
        })),
      };

      const p = Promise.resolve().then(() => scoreManualRoute(input));
      toast.promise(p, { loading: "Computing manual route…", success: "Manual route computed", error: "Failed to compute manual route", });

      const res = await p;

      const mm =  res.result?.metrics ?? null;
      if (mm) setManualMetrics(mm);

      // Show manual result (accordion below will render, foldable)
      setManualResult(res.result ?? null);

      const hasTemp = [depotId, ...siteIds].some((id) => String(id).startsWith("temp-"));
      if (hasTemp) {
        toast.error("Cannot save", { description: "Save the temporary sites first." });
        return;
      }

      // save a record
      const payload: OptimizationCreate = {
        name: `${selectedRun?.name ?? "MR"} • manual`,
        milk_run_id: selectedRunId,
        order_set_id: null,
        depot_id: depotId,
        site_ids: [...siteIds],
        vehicle_ids: [...manualVehicleIds],
        params: {
          optimization_arc: optimizationArc,
          solver_mode: solverMode,
          slack_time_seconds: Math.max(0, Math.round(slackMinutes)) * 60,
          site_vehicle_map: siteVehicleMap,
        } as any,
        metrics: mm ?? {
          solve_time: 0,
          total_distance: 0,
          total_vehicles_used: 0,
          unassigned_orders: 0,
          surface_utilization: 0,
          weight_utilization: 0,
          total_co2_emissions_kg: 0,
          avg_co2_per_km_kg: 0,
          virtual_sites_reverted: 0,
        },
        result: res.result ?? null,
        solver_run_id: res.solver_run_id ?? null,
        result_id: res.result_id ?? null,
        note: "manual",
      };

      try {
        await saveOptimization(payload);
        // refresh history only (no auto-fetch of "last manual")
        if (selectedRunId) {
          const fresh = await fetchOptimizationsByMilkRun(String(selectedRunId));
          const sorted = (fresh || []).slice().sort(
            (a: any, b: any) =>
              new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
          );
          setHistory(sorted);
        }
      } catch (dbErr) {
        console.error(dbErr);
        toast.error("Could not save (manual)", { description: "Check the backend database.", });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setManualProgressPct(100);
      clearManualProgress();
      setScoring(false);
    }
  };

  // Optimization handler
  const handleOptimize = async () => {
    if (!depotId || siteIds.length === 0) {
      toast.warning("Depot and sites required", { description: "Select a depot and at least one site.", });
      return;
    }
    if (!depot) {
      toast.error("Depot not found");
      return;
    }
    if (!optVehicles.length) {
      toast.warning("Vehicle required", { description: "Select at least one vehicle (vehicle list).", });
      return;
    }

    setLoading(true);
    setResult(null);
    setMetrics(null);
    setLastOptimMetrics(null);
    setLastOptimResult(null);

    startOptProgress(solverMode);

    try {
      const baseInput: OptimizerInput = generateOptimizerInputFromMilkRun(
        depot,
        siteIds,
        siteMap,
        optVehicles,
        drivers
      );

      let finalInput: OptimizerInput = sanitizeOptimizerInput({
        ...baseInput,
        optimization_arc: optimizationArc,
        solver_mode: solverMode,
        slack_time_seconds: Math.max(0, Math.round(slackMinutes)) * 60,
      });

      finalInput.vehicles = (finalInput.vehicles?.length ? finalInput.vehicles : optVehicles) as any;
      (finalInput as any).vehicle_ids = optVehicleIds.map(String);

      const rawById = buildRawById(optVehicles);
      finalInput = {
        ...finalInput,
        vehicles: (finalInput.vehicles || []).map((v: any) => {
          const id = vehicleIdOf(v);
          const raw = rawById.get(id);

          const maxMeters =
            v.max_distance_meters ??
            toMetersFromKm(v.max_distance) ??
            toMetersFromKm(raw?.max_distance) ??
            toMetersFromKm(raw?.max_distance_km) ??
            toMetersFromKm(raw?.range_km ?? raw?.autonomy_km);

          return {
            ...v,
            surface: scaleSurface(v.surface),
            weight: scaleWeight(v.weight),
            depot_id: undefined,
            ...(typeof maxMeters === "number" ? { max_distance_meters: maxMeters } : {}),
          };
        }),
      };

      if (!finalInput.vehicles || finalInput.vehicles.length === 0) {
        toast.error("No vehicles in request", { description: "Check the vehicle selection.", });
        setLoading(false);
        clearOptProgress();
        return;
      }

      const p = Promise.resolve().then(() => optimizeRoutes(finalInput));
      toast.promise(p, { loading: "Optimizing…", success: "Optimization complete", error: "Optimization failed", });

      const res = await p;
      setResult(res.result);

      const m = (res as any).metrics ?? res.result?.metrics ?? null;
      if (m) setMetrics(m as Metrics);

      setLastOptimMetrics((m as Metrics) ?? null);
      setLastOptimResult(res.result ?? null);
    } catch (e) {
      console.error(e);
    } finally {
      setOptProgressPct(100);
      clearOptProgress();
      setLoading(false);
    }
  };

  // Save optimized (from results component)
  const handleSaveOptimized = async (name: string) => {
    if (!depotId || siteIds.length === 0 || !lastOptimMetrics) {
      toast.error("Not enough data to save");
      return;
    }
    const hasTemp = [depotId, ...siteIds].some((id) => String(id).startsWith("temp-"));
    if (hasTemp) {
      toast.error("Cannot save", { description: "Save the temporary sites first." });
      return;
    }
    try {
      setSavingOptimized(true);
      const payload: OptimizationCreate = {
        name: name?.trim() || null,
        milk_run_id: selectedRunId || null,
        order_set_id: null,
        depot_id: depotId,
        site_ids: [...siteIds],
        vehicle_ids: [...optVehicleIds],
        params: {
          optimization_arc: optimizationArc,
          solver_mode: solverMode,
          slack_time_seconds: Math.max(0, Math.round(slackMinutes)) * 60,
          site_vehicle_map: siteVehicleMap,
        } as any,
        metrics: lastOptimMetrics,
        result: lastOptimResult,
        solver_run_id: null,
        result_id: null,
        note: "optimized",
      };
      await saveOptimization(payload);
      toast.success("Optimization saved");
      if (selectedRunId) {
        const fresh = await fetchOptimizationsByMilkRun(String(selectedRunId));
        const sorted = (fresh || []).slice().sort(
          (a: any, b: any) =>
            new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
        );
        setHistory(sorted);
      }
    } catch (dbErr) {
      console.error(dbErr);
      toast.error("Failed to save optimization", { description: "Check the backend database." });
    } finally {
      setSavingOptimized(false);
    }
  };

  // -------- Delete helpers for History --------
  const removeHistoryItem = (id: string) => {
    setHistory((prev: OptimizationRecord[]) =>
      prev.filter((h) => String(h.id) !== String(id))
    );
  };

  const doDeleteHistory = async (id: string) => {
    try {
      setDeletingIds((s: Iterable<string> | null | undefined) => new Set(s).add(String(id)));
      await deleteOptimization(String(id));
      removeHistoryItem(String(id));
      toast.success("Optimization deleted", { description: `#${id} was deleted.`, });
      if (selectedHistory && String(selectedHistory.id) === String(id)) setSelectedHistory(null);
    } catch (e: any) {
      console.error(e);
      toast.error("Delete failed", { description: e?.message || "Could not delete this item.", });
    } finally {
      setDeletingIds((s: Iterable<string> | null | undefined) => {
        const n = new Set(s);
        n.delete(String(id));
        return n;
      });
      setPendingDeleteId(null);
    }
  };

  const optExpectedSec = MODE_EXPECTED_SECONDS[optMode];
  const manualExpectedSec = MODE_EXPECTED_SECONDS[manualMode];

  const handleManualButton = () => {
    if (!selectedRunId) {
      toast.info("Select or create a milk run before computing the manual route.");
      return;
    }
    scoreAndSaveManual();
  };

  // Restore editor context from a history record
  const restoreFromHistory = (rec: OptimizationRecord) => {
    try {
      const dId = (rec as any).depot_id ? String((rec as any).depot_id) : "";
      const sIds = Array.isArray((rec as any).site_ids) ? (rec as any).site_ids.map(String) : [];
      const vIds = Array.isArray((rec as any).vehicle_ids) ? (rec as any).vehicle_ids.map(String) : [];
      const map = (rec as any)?.params?.site_vehicle_map || {};

      if (dId) setDepotId(dId);
      if (sIds.length) setSiteIds(sIds);
      if (vIds.length) setSelectedVehicleIds(vIds);
      setSiteVehicleMap(map);

      toast.success("Context restored", { description: `Reloaded from history #${rec.id}.`, });
    } catch (e) {
      console.error(e);
    }
  };

  // scroll preview into view when selecting
  useEffect(() => {
    if (selectedHistory && historyPreviewRef.current) {
      historyPreviewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedHistory]);

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RouteIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
          <h1 className="text-2xl font-bold">Milk run optimization</h1>
        </div>
      </div>

      {/* Editor */}
      <div className="flex items-center justify-end mb-2">
        <TempSiteDialog
          trigger={
            <Button
              variant="outline"
              className="inline-flex items-center gap-2 border-border/70 ring-1 ring-primary/20 shadow-sm"
              aria-label="Add a temporary site"
              title="Add a temporary site"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add a temporary site
            </Button>
          }
          onCreate={(site) => setTempSites((prev) => [...prev, site])}
        />
      </div>
      <MilkRunEditor
        allSites={allSites}
        allVehicles={vehicles}
        initialDepotId={depotId || undefined}
        initialSiteIds={siteIds.length ? siteIds : undefined}
        initialVehicleIds={selectedVehicleIds.length ? selectedVehicleIds : undefined}
        initialSiteVehicleMap={Object.keys(siteVehicleMap).length ? siteVehicleMap : undefined}
        onChange={(nextDepotId: string, list: string[], vehIds: any, nextMap: any) => {
          const ids = (Array.isArray(vehIds) ? vehIds : vehIds ? [vehIds] : [])
            .filter(Boolean)
            .map(String);

          setDepotId((prev: string) => (prev === (nextDepotId as string) ? prev : (nextDepotId as string)));
          setSiteIds((prev: string[]) => (shallowEqualArr(prev, list) ? prev : [...list]));
          setSelectedVehicleIds((prev: string[]) => (shallowEqualArr(prev, ids) ? prev : [...ids]));
          setSiteVehicleMap((prev: Record<string, string>) => (shallowEqualMap(prev, nextMap || {}) ? prev : { ...(nextMap || {}) }));

          const first = ids[0] ?? "";
          setSelectedVehicleId((prev: string) => (prev === first ? prev : first));
        }}
        onRunSelected={setSelectedRun}
        onAfterSave={() => {
          toast.message("Milk run saved.", { description: "Click “Compute & save manual route” to create a manual result.", });
        }}
      />

      {/* Manual scoring progress */}
      {scoring && (
        <div className="place-items-center">
          <SpinnerWithText
            label="Computing manual route…"
            progressPct={manualProgressPct}
            elapsedSec={manualElapsedSec}
            expectedSec={manualExpectedSec}
            mode={manualMode}
            finalizing={manualProgressPct >= 99}
          />
        </div>
      )}

      {/* Manual compute & save (explicit) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
            Manual route
          </CardTitle>
          <CardDescription>
            Computes and saves the milk run based on the per-site vehicle assignments.
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent>
          <Button
            onClick={handleManualButton}
            disabled={scoring || !depotId || siteIds.length === 0 || manualVehicleIds.length === 0}
            className="gap-2"
            variant="secondary"
          >
            <Save className="h-4 w-4" aria-hidden />
            Compute & save manual route
          </Button>
          <div className="mt-2 text-sm text-muted-foreground">
            {!selectedRunId && "ℹ️ Select or create a milk run. "}
            {!depotId && "⚠️ Select a depot. "}
            {!siteIds.length && "⚠️ Add at least one site. "}
            {depotId && siteIds.length > 0 && manualVehicleIds.length === 0 && "⚠️ Assign at least one vehicle per site (or for some sites). "}
          </div>
        </CardContent>
      </Card>

      {/* ▶ Manual result (accordion) — foldable & only shown after button run */}
      {manualResult && (
        <Card className="overflow-visible">
          <Accordion
            className="overflow-visible ml-4 mr-4"
            type="single"
            collapsible
            // no controlled value: starts collapsed, user can fold/unfold
          >
            <AccordionItem value="manual-result">
              <AccordionTrigger>
                <div className="flex flex-col ml-5">
                  <span className="font-semibold">Manual route</span>
                  <span className="text-sm text-muted-foreground">Latest result (session)</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="max-h-[85vh] overflow-auto rounded-md">
                  <OptimizerResults
                    key={`manual-accordion-${mapEpoch}`}
                    result={manualResult}
                    sites={allSites}
                    vehicles={vehicles}
                    drivers={drivers}
                    nameDisabled
                    defaultName={`${selectedRun?.name ?? "MR"} • manuel`}
                    mapkey=""
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      )}

      {/* Options (for optimization) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-muted-foreground" aria-hidden />
            Optimization parameters
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex-1">
              <Label htmlFor="arc" className="mb-2 block">
                Strategy
              </Label>
              <Select
                value={optimizationArc}
                onValueChange={(v: string) => setOptimizationArc(v as Arc)}
              >
                <SelectTrigger id="arc">
                  <SelectValue placeholder="Min time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="distance">Min Distance</SelectItem>
                  <SelectItem value="co2">Min CO₂</SelectItem>
                  <SelectItem value="duration">Min time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1">
              <Label htmlFor="solver" className="mb-2 block">
                Mode
              </Label>
              <Select
                value={solverMode}
                onValueChange={(v: string) => setSolverMode(v as Solver)}
              >
                <SelectTrigger id="solver">
                  <SelectValue placeholder="Balanced" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="fast">Fast</SelectItem>
                  <SelectItem value="optimal">Optimal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1">
              <Label htmlFor="slack" className="mb-2 flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden />
                Allowed early/late tolerance (minutes)
              </Label>
              <input
                id="slack"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={slackMinutes}
                onChange={(e: { target: HTMLInputElement }) =>
                  setSlackMinutes(Math.max(0, Number((e.target as HTMLInputElement).value || 0)))
                }
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          <div className="pt-2">
            <Button
              onClick={handleOptimize}
              disabled={loading}
              className="gap-2"
            >
              <Rocket className="h-4 w-4" aria-hidden />
              Run optimization
            </Button>

            <div className="mt-2 text-sm text-muted-foreground">
              {!depotId && "⚠️ Select a depot. "}
              {!siteIds.length && "⚠️ Add at least one site. "}
              {!optVehicles.length && "⚠️ Select at least one vehicle. "}
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="place-items-center">
          <SpinnerWithText
            label="Optimizing milk run…"
            progressPct={optProgressPct}
            elapsedSec={optElapsedSec}
            expectedSec={optExpectedSec}
            mode={optMode}
            finalizing={optProgressPct >= 99}
          />
        </div>
      )}
      
      {/* ▶ Optimized result */}
      {result && (
        <div className="pt-4 space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Optimized route</CardTitle>
              <CardDescription>Optimizer result for the selected strategy and mode.</CardDescription>
            </CardHeader>
          </Card>
          <OptimizerResults
            key={`optimized-${mapEpoch}`}
            result={result}
            sites={allSites}
            vehicles={vehicles}
            drivers={drivers}
            defaultName={`${selectedRun?.name ?? "MR"} • ${optimizationArc}/${solverMode}`}
            saving={savingOptimized}
            onSave={handleSaveOptimized}
          />
        </div>
      )}

      {/* History of saved optimizations for the selected milk run */}
      {selectedRunId && (
        <Card>
          <CardHeader>
            <CardTitle>Optimization history</CardTitle>
            <CardDescription>
              For this milk run: {selectedRun?.name}
            </CardDescription>
          </CardHeader>
          <Separator />
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved optimizations
              </p>
            ) : (
              <ul className="divide-y">
                {history.map((h: OptimizationRecord) => {
                  const idStr = String(h.id);
                  const isDeleting = deletingIds.has(idStr);

                  const arc = (h as any)?.params?.optimization_arc ?? "—";
                  const mode = (h as any)?.params?.solver_mode ?? "—";

                  const m = (h as any)?.metrics;
                  const dist = typeof m?.total_distance === "number" ? Math.round(m.total_distance/1000) : "—";
                  const veh = m?.total_vehicles_used ?? "—";
                  const pickNum = (...vals: Array<number | undefined | null>) =>
                    vals.find((v) => typeof v === "number" && !Number.isNaN(v)) ?? 0;
                  const co2 = pickNum(
                    m?.total_co2_emissions_kg,
                    typeof m?.total_co2_emissions_g === "number"
                      ? m.total_co2_emissions_g / 1000
                      : undefined,
                    typeof m?.total_co2_emissions === "number"
                      ? m.total_co2_emissions / 1000
                      : undefined
                  );
                  const created =
                    (h as any)?.created_at ? new Date((h as any).created_at as any).toLocaleString() : "—";

                  return (
                    <li key={h.id as any} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        {/* Clickable area to preview */}
                        <button
                          type="button"
                          onClick={() => setSelectedHistory(h)}
                          className="group text-left flex-1 rounded px-2 py-1 transition hover:bg-muted focus:outline-none focus-visible:ring"
                          title="Preview this optimization"
                        >
                          <div className="font-medium text-sm flex items-center gap-2">
                            <span className="inline-flex shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">#{idStr}</span>
                            <span className="truncate">{h.name || `${selectedRun?.name ?? "MR"} • ${arc}/${mode}`}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {created} · {arc} / {mode} · Dist: {dist} km · Veh: {veh} · CO₂: {co2} kg {h.note ? `· ${h.note}` : ""}
                          </div>
                        </button>

                        {/* Delete action with confirm */}
                        <AlertDialog
                          open={pendingDeleteId === idStr}
                          onOpenChange={(open) => !open && setPendingDeleteId(null)}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="gap-2 shrink-0"
                              disabled={isDeleting}
                              onClick={() => setPendingDeleteId(idStr)}
                              title="Delete this optimization"
                            >
                              <Trash2 className="h-4 w-4" />
                              {isDeleting ? "Deleting…" : "Delete"}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this optimization?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. Optimization #{idStr} will be permanently deleted.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => doDeleteHistory(idStr)}
                              >
                                Confirm deletion
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ▶ Preview of a selected history record */}
      {selectedHistory && (
        <Card ref={historyPreviewRef} className="border-primary/30">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                History preview
                <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">#{String(selectedHistory.id)}</span>
              </CardTitle>
              <CardDescription>
                {(selectedHistory as any)?.created_at ? new Date((selectedHistory as any).created_at as any).toLocaleString() : "—"}
                {" · "}
                {(selectedHistory as any)?.params?.optimization_arc ?? "—"} / {(selectedHistory as any)?.params?.solver_mode ?? "—"}
                {selectedHistory.note ? ` · ${selectedHistory.note}` : ""}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => restoreFromHistory(selectedHistory)} title="Restore this context in the editor">
                <RotateCcw className="h-4 w-4" /> Restore in editor
              </Button>
              <Button variant="ghost" size="sm" className="gap-2" onClick={() => setSelectedHistory(null)} title="Close preview">
                <X className="h-4 w-4" /> Close
              </Button>
            </div>
          </CardHeader>
          <Separator />
          <CardContent>
            <OptimizerResults
              key={`history-${mapEpoch}-${String(selectedHistory.id)}`}
              result={(selectedHistory as any).result as OptimizerResult}
              sites={allSites}
              vehicles={vehicles}
              drivers={drivers}
              nameDisabled
              defaultName={String((selectedHistory as any).name || `${selectedRun?.name ?? "MR"} • ${(selectedHistory as any)?.params?.optimization_arc ?? "—"}/${(selectedHistory as any)?.params?.solver_mode ?? "—"}`)}
              // no saving from preview
              saving={false}
              onSave={undefined as any}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}



