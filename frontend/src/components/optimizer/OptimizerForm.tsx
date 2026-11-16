// src/components/optimizer/OptimizerForm.tsx
/* eslint-disable react-hooks/exhaustive-deps */
import { memo, useEffect, useMemo, useState } from "react";
import type { Order, OrderSet } from "@/types/order";
import type { Vehicle, Driver } from "@/types/vehicle";
import type { Site } from "@/types/site";
import type { OptimizerInput } from "@/types/optimizer";
import { fetchOrderSets, loadOrderSet } from "@/api/order_sets";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Database,
  FolderOpen,
  SlidersHorizontal,
  Gauge,
  Rocket,
  Truck,
  Warehouse,
} from "lucide-react";
import {
  normalizeCategory,
  sanitizeOptimizerInput,
} from "@/utils/sanitizeOptimizerInput";
import { toast } from "sonner";

type Mode = "memory" | "saved";
type Arc = "distance" | "co2" | "duration";
type SolverMode = "balanced" | "fast" | "optimal";

type Props = {
  vehicles: Vehicle[];
  drivers: Driver[];
  sites: Site[];
  inMemoryOrders: Order[];
  onSubmit: (input: OptimizerInput) => void;

  /** NEW: bubble up the current source (memory | saved) */
  onSourceChange?: (mode: Mode) => void;
  /** NEW: bubble up the chosen saved set id (or null when none/cleared) */
  onSavedSetChange?: (orderSetId: string | null) => void;
};

/** -------------------- SCALING -------------------- */
const SURFACE_SCALE_FACTOR = Number(import.meta.env.VITE_SURFACE_SCALE_FACTOR ?? 100);
const WEIGHT_SCALE_FACTOR = Number(import.meta.env.VITE_WEIGHT_SCALE_FACTOR ?? 100);

const scaleSurface = (x: unknown) => Math.round((Number(x) || 0) * SURFACE_SCALE_FACTOR);
const scaleWeight = (x: unknown) => Math.round((Number(x) || 0) * WEIGHT_SCALE_FACTOR);
/** ------------------------------------------------ */

function OptimizerForm({
  vehicles,
  drivers,
  sites,
  inMemoryOrders,
  onSubmit,
  onSourceChange,
  onSavedSetChange,
}: Props) {
  const [mode, setMode] = useState<Mode>("memory");
  const [savedSets, setSavedSets] = useState<OrderSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState("");

  // ✓ Default strategy: Min time
  const [arc, setArc] = useState<Arc>("duration");

  const [solver, setSolver] = useState<SolverMode>("balanced");

  // ✓ Slack now in MINUTES (default 0)
  const [slackMinutes, setSlackMinutes] = useState<number>(0);

  // ---- Depots multi-select ----
  const [selectedDepotIds, setSelectedDepotIds] = useState<string[]>([]);
  const [depotOpen, setDepotOpen] = useState(false);
  const [depotQuery, setDepotQuery] = useState("");

  // ---- Vehicle multi-select (default: select all) ----
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>(
    () => vehicles.map((v) => v.id_vehicule) // preselect all
  );

  useEffect(() => {
    setSelectedVehicleIds((prev) => {
      const allowed = new Set(vehicles.map((v) => v.id_vehicule));
      const next = prev.filter((id) => allowed.has(id));
      return next.length ? next : vehicles.map((v) => v.id_vehicule);
    });
  }, [vehicles]);

  const toggleVehicle = (id: string) => {
    setSelectedVehicleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAllVehicles = () =>
    setSelectedVehicleIds(vehicles.map((v) => v.id_vehicule));
  const clearAllVehicles = () => setSelectedVehicleIds([]);

  const siteById = useMemo(() => {
    const m = new Map<string, Site>();
    for (const s of sites) m.set(s.id, s);
    return m;
  }, [sites]);

  const depotSites = useMemo(
    () => sites.filter((s) => normalizeCategory(s.category) === "depot"),
    [sites]
  );

  useEffect(() => {
    setSelectedDepotIds((prev) => {
      const allowed = new Set(depotSites.map((d) => d.id));
      const next = prev.filter((id) => allowed.has(id));
      if (next.length) return next;
      return depotSites.map((d) => d.id);
    });
  }, [depotSites]);

  useEffect(() => {
    if (mode === "saved") {
      fetchOrderSets().then(setSavedSets).catch((e) => {
        console.error(e);
        toast.error("Could not load saved order sets");
      });
    }
    onSourceChange?.(mode);
    if (mode !== "saved") {
      setSelectedSetId("");
      onSavedSetChange?.(null);
    }
  }, [mode]);

  useEffect(() => {
    onSavedSetChange?.(selectedSetId || null);
  }, [selectedSetId]);

  // helper removed (unused) — site lookups use siteById directly

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

  const handleRun = async () => {
    let orders: Order[] = [];

    if (mode === "memory") {
      orders = inMemoryOrders;
    } else {
      if (!selectedSetId) {
        toast.warning("Order set required", { description: "Select a saved order set." });
        return;
      }
      try {
        const set = await loadOrderSet(selectedSetId);
        orders = set.orders || [];
      } catch (e) {
        console.error(e);
        toast.error("Failed to load the selected order set");
        return;
      }
    }

    if (!orders.length) {
      toast.warning("No orders", { description: "Add orders or choose a non-empty order set." });
      return;
    }

    if (depotSites.length === 0) {
      toast.error("No depot", { description: "Create at least one site with category depot." });
      return;
    }

    if (!selectedDepotIds.length) {
      toast.warning("Depot required", { description: "Select at least one depot." });
      return;
    }

    if (!selectedVehicleIds.length) {
      toast.warning("Vehicle required", { description: "Select at least one vehicle." });
      return;
    }

    const missingSiteIds: string[] = [];
    const safeGetSite = (id: string) => {
      const found = siteById.get(id);
      if (!found) missingSiteIds.push(id);
      return found;
    };

    const selectedDepots = selectedDepotIds
      .map((id) => safeGetSite(id))
      .filter(Boolean)
      .map((s) => toSiteInput(s as Site, "depot"));

    // Build solver orders
    const optimizerOrders = orders
      .map((o) => {
        const sourceSite = safeGetSite(o.pickup_site_id);
        const destSite = safeGetSite(o.delivery_site_id);
        if (!sourceSite || !destSite) return null;
        return {
          order_id: o.id,
          floor: o.surface, // keep as-is; solver-side can scale if needed
          weight: o.weight,
          hazardous_types: o.hazardous_types ? [] : [],
          required_utilities: o.requires_refrigeration ? [] : [],
          source: toSiteInput(sourceSite),
          destination: toSiteInput(destSite),
          priority: 1,
        };
      })
      .filter(Boolean) as any[];

    if (missingSiteIds.length) {
      toast.error("Sites not found", {
        description: `The following IDs are missing: ${missingSiteIds.join(", ")}`,
      });
      return;
    }

    if (!optimizerOrders.length) {
      toast.error("No usable orders", {
        description: "Check the pickup/delivery sites.",
      });
      return;
    }

    // Vehicles BEFORE scaling (keeps original array intact)
    const selectedVehiclesRaw = vehicles.filter((v) =>
      selectedVehicleIds.includes(v.id_vehicule)
    );

    // Derive drivers from selected vehicles
    const driverIdSet = new Set<string>();
    for (const v of selectedVehiclesRaw) (v.driver_ids || []).forEach((id) => driverIdSet.add(String(id)));
    let selectedDrivers = drivers.filter((d) => driverIdSet.has(String(d.id)));
    if (selectedDrivers.length < selectedVehiclesRaw.length) {
      selectedDrivers = drivers.slice();
    }

    // First sanitize to the canonical OptimizerInput shape
    let input: OptimizerInput = sanitizeOptimizerInput({
      depots: selectedDepots,
      vehicles: selectedVehiclesRaw,
      drivers: selectedDrivers,
      orders: optimizerOrders,
      // ✓ convert minutes -> seconds
      slack_time_seconds: Math.max(0, Math.round(slackMinutes)) * 60,
      optimization_arc: arc,
      solver_mode: solver,
    });

    // ✓ FINAL GUARANTEE: scale vehicle capacities that leave this component
      input = {
      ...input,
      vehicles: input.vehicles.map((v: any) => ({
        ...v,
        surface: scaleSurface(v.surface),
        weight: scaleWeight(v.weight),
        depot_id: undefined,
      })),
    };

    onSavedSetChange?.(mode === "saved" ? selectedSetId || null : null);
    onSubmit(input);
  };

  // ✓ Search by id OR label; display label but keep id as value
  const filteredVehicles = useMemo(() => {
    const q = vehicleQuery.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((v) => {
      const label = String((v as any).label ?? v.id_vehicule ?? "").toLowerCase();
      const id = String(v.id_vehicule ?? "").toLowerCase();
      return label.includes(q) || id.includes(q);
    });
  }, [vehicles, vehicleQuery]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-muted-foreground" aria-hidden />
          Prepare optimization
        </CardTitle>
        <CardDescription>
          Select orders, vehicles, strategy and solver parameters.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-6 p-4">
        {/* Source selection */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="flex-1">
            <Label className="mb-2 flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
              Order source
            </Label>
            <Select value={mode} onValueChange={(v: Mode) => setMode(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="memory">Current orders</SelectItem>
                <SelectItem value="saved">Saved order set</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Depots multi-select */}
          <div className="flex-1">
            <Label className="mb-2 flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-muted-foreground" aria-hidden />
              Depots
            </Label>
            <Popover open={depotOpen} onOpenChange={setDepotOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {selectedDepotIds.length > 0
                    ? `${selectedDepotIds.length} selected`
                    : "Select…"}
                  <kbd className="ml-2 rounded border bg-muted px-1 text-[10px]">⌄</kbd>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[420px] p-0" align="start">
                <div className="flex items-center justify-between px-2 py-2">
                  <div className="text-xs text-muted-foreground">
                    {selectedDepotIds.length} selected
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSelectedDepotIds(depotSites.map((d) => d.id))} disabled={!depotSites.length}>
                      Select all
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSelectedDepotIds([])}>
                      Remove all
                    </Button>
                  </div>
                </div>
                <Command>
                  <CommandInput
                    placeholder="Search depots"
                    value={depotQuery}
                    onValueChange={setDepotQuery}
                  />
                  <CommandList>
                    <CommandEmpty>{depotSites.length === 0 ? "No depot available" : "No results"}</CommandEmpty>
                    <CommandGroup heading="Depots">
                      <ScrollArea className="max-h-64">
                        {depotSites
                          .filter((d) =>
                            `${d.name} ${d.address ?? ""}`.toLowerCase().includes(depotQuery.trim().toLowerCase())
                          )
                          .map((d) => {
                            const checked = selectedDepotIds.includes(d.id);
                            return (
                              <CommandItem
                                key={d.id}
                                value={`${d.name} ${d.address ?? ""}`}
                                onSelect={() =>
                                  setSelectedDepotIds((prev) =>
                                    prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                                  )
                                }
                                className="flex items-center justify-between"
                              >
                                <span className="truncate">{d.name}</span>
                                <input type="checkbox" readOnly checked={checked} className="h-4 w-4" />
                              </CommandItem>
                            );
                          })}
                      </ScrollArea>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {mode === "saved" && (
            <div className="flex-1">
              <Label className="mb-2 block">Saved order set</Label>
              <Select value={selectedSetId} onValueChange={setSelectedSetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {savedSets.map((set) => (
                    <SelectItem key={set.id} value={set.id}>
                      {set.name} ({new Date(set.created_at).toLocaleDateString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Vehicles multi-select */}
          <div className="flex-1">
            <Label className="mb-2 flex items-center gap-2">
              <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
              Vehicles
            </Label>
            <Popover open={vehicleOpen} onOpenChange={setVehicleOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {selectedVehicleIds.length > 0
                    ? `${selectedVehicleIds.length} selected`
                    : "Select…"}
                  <kbd className="ml-2 rounded border bg-muted px-1 text-[10px]">⌄</kbd>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[420px] p-0" align="start">
                <div className="flex items-center justify-between px-2 py-2">
                  <div className="text-xs text-muted-foreground">
                    {selectedVehicleIds.length} selected
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={selectAllVehicles}>
                      Select all
                    </Button>
                    <Button size="sm" variant="outline" onClick={clearAllVehicles}>
                      Remove all
                    </Button>
                  </div>
                </div>
                <Command>
                    <CommandInput
                    placeholder="Search (label, id)…"
                    value={vehicleQuery}
                    onValueChange={setVehicleQuery}
                  />
                  <CommandList>
                    <CommandEmpty>No vehicles</CommandEmpty>
                    <CommandGroup heading="Vehicles">
                      <ScrollArea className="max-h-64">
                        {filteredVehicles.map((v) => {
                          const id = v.id_vehicule;
                          const checked = selectedVehicleIds.includes(id);
                          const label = String((v as any).label ?? id);
                          return (
                            <CommandItem
                              key={id}
                              value={`${label} ${id}`}
                              onSelect={() => toggleVehicle(id)}
                              className="flex items-center justify-between"
                            >
                              <span className="truncate">{label}</span>
                              <input type="checkbox" readOnly checked={checked} className="h-4 w-4" />
                            </CommandItem>
                          );
                        })}
                      </ScrollArea>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Strategy & solver */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex-1">
            <Label className="mb-2 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden />
              Strategy
            </Label>
            <Select value={arc} onValueChange={(v: Arc) => setArc(v)}>
              <SelectTrigger>
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
            <Label className="mb-2 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
              Mode
            </Label>
            <Select value={solver} onValueChange={(v: SolverMode) => setSolver(v)}>
                <SelectTrigger>
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
            <Label className="mb-2 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden />
              Allowed early/late tolerance (minutes)
            </Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={slackMinutes}
              onChange={(e) => setSlackMinutes(Math.max(0, Number(e.target.value || 0)))}
              inputMode="numeric"
            />
          </div>
        </div>

        <Button className="w-full mt-2 gap-2" onClick={handleRun}>
          <Rocket className="h-4 w-4" />
          Run optimization
        </Button>
      </CardContent>
    </Card>
  );
}

export default memo(OptimizerForm);
