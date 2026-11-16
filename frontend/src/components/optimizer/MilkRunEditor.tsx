/* eslint-disable react-hooks/exhaustive-deps */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Site } from "@/types/site";
import type { MilkRun } from "@/types/milk_run";
import type { Vehicle } from "@/types/vehicle";
import { fetchMilkRuns, createMilkRun, updateMilkRun, deleteMilkRun } from "@/api/milk_runs";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";

import {
  Map as MapIcon,
  Home,
  Plus,
  Save,
  Copy,
  Trash2,
  ChevronUp,
  ChevronDown,
  List,
  Search,
  Truck,
} from "lucide-react";

type Props = {
  allSites: Site[];
  allVehicles?: Vehicle[];
  /**
   * onChange(depotId, siteIds, vehicleIds?, siteVehicleMap?)
   */
  onChange: (
    depotId: string,
    siteIds: string[],
    vehicleIds?: string[],
    siteVehicleMap?: Record<string, string>
  ) => void;
  onRunSelected?: (run: MilkRun | null) => void;
  onAfterSave?: (run: MilkRun) => void;

  /** NEW: optional initial values when no run is selected */
  initialDepotId?: string;
  initialSiteIds?: string[];
  initialVehicleIds?: string[];
  initialSiteVehicleMap?: Record<string, string>;
};

const toId = (v: unknown) => String(v ?? "").trim();

// sentinel for "no vehicle" in per-site Select (Radix disallows empty string values)
const NONE_VALUE = "__none__";

const normalizeIdArray = (arr: unknown[] | undefined | null): string[] => {
  const set = new Set<string>();
  for (const v of arr ?? []) {
    const s = toId(v);
    if (s) set.add(s);
  }
  return Array.from(set);
};

function MilkRunEditor({
  allSites,
  allVehicles,
  onChange,
  onRunSelected,
  onAfterSave,
  initialDepotId,
  initialSiteIds,
  initialVehicleIds,
  initialSiteVehicleMap,
}: Props) {
  const [milkRuns, setMilkRuns] = useState<MilkRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<MilkRun | null>(null);
  const [runName, setRunName] = useState("");
  const [depotId, setDepotId] = useState("");

  // depot combobox state
  const [depotOpen, setDepotOpen] = useState(false);
  const [depotQuery, setDepotQuery] = useState("");

  const [siteIds, setSiteIds] = useState<string[]>([]);

  // multiple vehicles selection (persisted as vehicle_ids: string[])
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [vehicleQuery, setVehicleQuery] = useState("");

  // per-site vehicle mapping { [siteId]: vehicleId }
  const [siteVehicleMap, setSiteVehicleMap] = useState<Record<string, string>>({});

  // add-site combobox
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");

  // filter for selected sites panel
  const [selectedFilter, setSelectedFilter] = useState("");

  const [busy, setBusy] = useState(false);

  // refs for scroll-top-on-search
  const depotListRef = useRef<HTMLDivElement | null>(null);
  const vehicleListRef = useRef<HTMLDivElement | null>(null);
  const addSiteListRef = useRef<HTMLDivElement | null>(null);
  const selectedSitesScrollRef = useRef<HTMLDivElement | null>(null);

  // fetch runs once
  useEffect(() => {
    fetchMilkRuns().then(setMilkRuns).catch(console.error);
  }, []);

  const forceOnChange = () => {
    onChange(toId(depotId), [...siteIds], [...selectedVehicleIds], { ...siteVehicleMap });
  };

  // -------------------------- APPLY SELECTED RUN --------------------------
  useEffect(() => {
    if (selectedRun) {
      setSiteIds((selectedRun.site_ids ?? []).map(toId));
      setRunName(selectedRun.name ?? "");
      setDepotId(toId(selectedRun.depot_id));

      const savedVehicleIds = normalizeIdArray(
        (selectedRun as unknown as { vehicle_ids?: unknown[] })?.vehicle_ids
      );
      setSelectedVehicleIds(savedVehicleIds);

      // Load persisted site_vehicle_map if available
      const maybeMap =
        (selectedRun as unknown as { site_vehicle_map?: Record<string, string> })?.site_vehicle_map || {};
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(maybeMap || {})) {
        const sid = toId(k);
        const vid = toId(v);
        if (sid && vid) clean[sid] = vid;
      }
      setSiteVehicleMap(clean);
    } else {
      // do NOT clear here — initial* sync below will decide
      setRunName("");
    }
    onRunSelected?.(selectedRun);
  }, [selectedRun, onRunSelected]);

  // -------------------------- INITIAL* SYNC (NO RUN) --------------------------
  // If no run is selected, populate from initial* props and keep in sync.
  useEffect(() => {
    if (selectedRun) return;

    // Helper to compare arrays (as sets)
    const eqArr = (a: string[], b: string[] = []) => {
      const aa = [...a].map(String).sort().join("|");
      const bb = [...b].map(String).sort().join("|");
      return aa === bb;
    };
    // Helper to compare maps
    const eqMap = (a: Record<string, string>, b: Record<string, string> = {}) => {
      const sa = Object.entries(a).map(([k, v]) => `${k}:${v}`).sort().join("|");
      const sb = Object.entries(b).map(([k, v]) => `${k}:${v}`).sort().join("|");
      return sa === sb;
    };

    const nextDepot = toId(initialDepotId);
    const nextSites = normalizeIdArray(initialSiteIds);
    const nextVehs = normalizeIdArray(initialVehicleIds);
    const nextMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(initialSiteVehicleMap ?? {})) {
      const sid = toId(k);
      const vid = toId(v);
      if (sid && vid) nextMap[sid] = vid;
    }

    // set only if different (so we don't fight user typing)
    if (nextDepot && nextDepot !== depotId) setDepotId(nextDepot);
    if (!eqArr(siteIds, nextSites)) setSiteIds(nextSites);
    if (!eqArr(selectedVehicleIds, nextVehs)) setSelectedVehicleIds(nextVehs);
    if (!eqMap(siteVehicleMap, nextMap)) setSiteVehicleMap(nextMap);
  }, [selectedRun, initialDepotId, initialSiteIds, initialVehicleIds, initialSiteVehicleMap]);

  // -------------------------- PARENT onChange (debounced) --------------------------
  const debounceTimer = useRef<number | null>(null);
  useEffect(() => {
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      onChange(toId(depotId), [...siteIds], [...selectedVehicleIds], { ...siteVehicleMap });
      debounceTimer.current = null;
    }, 150);
    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    };
  }, [depotId, siteIds, selectedVehicleIds, siteVehicleMap, onChange]);

  // maps & filtered lists
  const siteMap = useMemo(() => {
    const m = new Map<string, Site>();
    for (const s of allSites) m.set(s.id, s);
    return m;
  }, [allSites]);

  const availableSites = useMemo(() => {
    const used = new Set(siteIds);
    return allSites.filter((s) => !used.has(s.id));
  }, [allSites, siteIds]);

  const selectedSites = useMemo(() => {
    const q = selectedFilter.trim().toLowerCase();
    if (!q) return siteIds;
    return siteIds.filter((id) => {
      const s = siteMap.get(id);
      const full = `${s?.name ?? ""} ${getCity(s)} ${s?.address ?? ""}`.toLowerCase();
      return full.includes(q);
    });
  }, [siteIds, siteMap, selectedFilter]);

  // vehicles: display label but store id
  const allVehicleOptions = useMemo(() => {
    return (allVehicles ?? [])
      .map((v) => ({
        id: toId((v as any).id ?? (v as any).vehicle_id),
        label: toId((v as any).label || (v as any).registration || (v as any).name || (v as any).code || (v as any).id),
      }))
      .filter((v) => v.id); // IMPORTANT: filter out empties
  }, [allVehicles]);

  const filteredVehicles = useMemo(() => {
    const q = vehicleQuery.trim().toLowerCase();
    if (!q) return allVehicleOptions;
    return allVehicleOptions.filter((v) => `${v.label} ${v.id}`.toLowerCase().includes(q));
  }, [allVehicleOptions, vehicleQuery]);

  // scroll-top effects when search inputs change
  useEffect(() => {
    if (depotListRef.current) depotListRef.current.scrollTop = 0;
  }, [depotQuery]);
  useEffect(() => {
    if (vehicleListRef.current) vehicleListRef.current.scrollTop = 0;
  }, [vehicleQuery]);
  useEffect(() => {
    if (addSiteListRef.current) addSiteListRef.current.scrollTop = 0;
  }, [addQuery]);
  useEffect(() => {
    if (selectedSitesScrollRef.current) selectedSitesScrollRef.current.scrollTop = 0;
  }, [selectedFilter]);

  // handlers
  const toggleVehicle = (idRaw: unknown) => {
    const id = toId(idRaw);
    if (!id) return;
    setSelectedVehicleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const selectAllVehicles = () =>
    setSelectedVehicleIds(normalizeIdArray((allVehicles ?? []).map((v) => (v as any).id)));
  const clearAllVehicles = () => setSelectedVehicleIds([]);

  const removeSite = (id: string) => {
    setSiteIds((prev) => prev.filter((s) => s !== id));
    setSiteVehicleMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const addSite = (id: string) => {
    const sid = toId(id);
    setSiteIds((prev) => (prev.includes(sid) ? prev : [...prev, sid]));
    setIsAddOpen(false);
  };
  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    setSiteIds((prev) => {
      const next = prev.slice();
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };
  const moveDown = (idx: number) => {
    setSiteIds((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = prev.slice();
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      return next;
    });
  };
  const clearAllSites = () => {
    setSiteIds([]);
    setSiteVehicleMap({});
  };

  const setVehicleForSite = (siteId: string, vehicleId: string) => {
    const sid = toId(siteId);
    const vid = toId(vehicleId);
    setSiteVehicleMap((prev) => {
      const next = { ...prev };
      if (!vid) delete next[sid];
      else next[sid] = vid;
      return next;
    });
  };

  const handleNew = () => {
    setSelectedRun(null);
    setRunName("");
    setSiteIds(initialSiteIds ? normalizeIdArray(initialSiteIds) : []);
    setDepotId(toId(initialDepotId));
    setSelectedVehicleIds(initialVehicleIds ? normalizeIdArray(initialVehicleIds) : []);
    setSiteVehicleMap(
      Object.fromEntries(
        Object.entries(initialSiteVehicleMap ?? {}).map(([k, v]) => [toId(k), toId(v)]).filter(([k, v]) => k && v)
      )
    );
    forceOnChange();
  };

  const handleSave = async () => {
    if (!siteIds.length) return alert("Add at least one site.");
    if (!runName.trim()) return alert("Give the milk run a name.");
    if (!depotId) return alert("Choose a depot.");
    setBusy(true);
    try {
      const payload: any = {
        name: runName.trim(),
        site_ids: [...siteIds],
        depot_id: toId(depotId),
        vehicle_ids: [...selectedVehicleIds],
        // Persist per-site map if backend supports it
        site_vehicle_map: { ...siteVehicleMap },
      };
      if (!selectedRun) {
        const created = await createMilkRun(payload);
        setMilkRuns((prev) => [created, ...prev]);
        setSelectedRun(created);
        forceOnChange();
        onAfterSave?.(created);
      } else {
        const updated = await updateMilkRun(selectedRun.id, payload);
        setMilkRuns((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        setSelectedRun(updated);
        forceOnChange();
        onAfterSave?.(updated);
      }
    } catch (e) {
      console.error(e);
      alert("Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAs = async () => {
    if (!siteIds.length) return alert("Add at least one site.");
    if (!depotId) return alert("Choose a depot.");
    const name = prompt("Name for the new copy:", runName ? `${runName} (copy)` : "");
    if (!name) return;
    setBusy(true);
    try {
      const payload: any = {
        name: name.trim(),
        site_ids: [...siteIds],
        depot_id: toId(depotId),
        vehicle_ids: [...selectedVehicleIds],
        site_vehicle_map: { ...siteVehicleMap },
      };
      const created = await createMilkRun(payload);
      setMilkRuns((prev) => [created, ...prev]);
      setSelectedRun(created);
      forceOnChange();
      onAfterSave?.(created);
    } catch (e) {
      console.error(e);
      alert("Duplicate failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRun) return;
    if (!confirm(`Delete “${selectedRun.name}”?`)) return;
    setBusy(true);
    try {
      await deleteMilkRun(selectedRun.id);
      setMilkRuns((prev) => prev.filter((m) => m.id !== selectedRun.id));
      setSelectedRun(null);
      setRunName("");
      setSiteIds(initialSiteIds ? normalizeIdArray(initialSiteIds) : []);
      setDepotId(toId(initialDepotId));
      setSelectedVehicleIds(initialVehicleIds ? normalizeIdArray(initialVehicleIds) : []);
      setSiteVehicleMap(
        Object.fromEntries(
          Object.entries(initialSiteVehicleMap ?? {}).map(([k, v]) => [toId(k), toId(v)]).filter(([k, v]) => k && v)
        )
      );
      forceOnChange();
    } catch (e) {
      console.error(e);
      alert("Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  const arraysEqual = (a: string[], b: string[]) => {
    const aa = normalizeIdArray(a);
    const bb = normalizeIdArray(b);
    if (aa.length !== bb.length) return false;
    aa.sort();
    bb.sort();
    for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
    return true;
  };

  const mapsEqual = (a: Record<string, string>, b: Record<string, string>) => {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      const k = ak[i];
      if (k !== bk[i]) return false;
      if (toId(a[k]) !== toId(b[k])) return false;
    }
    return true;
  };

  const isDirty =
    !!selectedRun &&
    (runName.trim() !== (selectedRun.name ?? "").trim() ||
      JSON.stringify(siteIds) !== JSON.stringify((selectedRun.site_ids ?? []).map(toId)) ||
      toId(depotId) !== toId(selectedRun.depot_id) ||
      !arraysEqual(
        selectedVehicleIds,
        (((selectedRun as unknown as { vehicle_ids?: unknown[] })?.vehicle_ids as unknown as string[]) ?? [])
      ) ||
      !mapsEqual(
        siteVehicleMap,
        ((selectedRun as unknown as { site_vehicle_map?: Record<string, string> })?.site_vehicle_map ?? {})
      ));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
            Milk runs
          </CardTitle>
          <CardDescription>Create, edit and order sites, choose a depot and vehicles.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Top selectors */}
          <div className="grid gap-4 md:grid-cols-4">
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-2">
                <List className="h-4 w-4 text-muted-foreground" aria-hidden />
                Select a milk run
              </Label>
              <Select
                value={selectedRun?.id ?? ""}
                onValueChange={(id) => {
                  const run = milkRuns.find((m) => m.id === id) || null;
                  setSelectedRun(run);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose..." />
                </SelectTrigger>
                <SelectContent>
                  {milkRuns.map((run) => (
                    <SelectItem key={run.id} value={run.id}>
                      {run.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
                Name
              </Label>
              <Input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="Milk run name" />
            </div>

            {/* Searchable Depot combobox */}
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-2">
                <Home className="h-4 w-4 text-muted-foreground" aria-hidden />
                Depot
              </Label>
              <Popover open={depotOpen} onOpenChange={setDepotOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    {depotId
                      ? `${siteMap.get(depotId)?.name ?? depotId}${renderCitySuffix(siteMap.get(depotId)!)}`
                      : "Choose a site"}
                    <kbd className="ml-2 rounded border bg-muted px-1 text-[10px]">⌄</kbd>
                  </Button>
                </PopoverTrigger>

                <PopoverContent className="w-[420px] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search by name, city, address…"
                      value={depotQuery}
                      onValueChange={setDepotQuery}
                    />
                    <CommandList ref={depotListRef} className="max-h-64 overflow-y-auto">
                      <CommandEmpty>No sites</CommandEmpty>
                      <CommandGroup heading="Sites">
                        {allSites
                          .filter((s) => {
                            const q = depotQuery.trim().toLowerCase();
                            if (!q) return true;
                            const hay = `${s.name} ${getCity(s)} ${s.address ?? ""}`.toLowerCase();
                            return hay.includes(q);
                          })
                          .map((s) => (
                            <CommandItem
                              key={s.id}
                              value={`${s.name} ${getCity(s)} ${s.address ?? ""}`}
                              onSelect={() => {
                                setDepotId(s.id);
                                setDepotOpen(false);
                              }}
                            >
                              <div className="flex flex-col">
                                <span className="font-medium">{s.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {getCity(s)} {s.address ? `· ${s.address}` : ""}
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Vehicles multi-select (show label, store id) */}
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
                Vehicles (available)
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
                    <CommandList ref={vehicleListRef} className="max-h-64 overflow-y-auto">
                      <CommandEmpty>No vehicles</CommandEmpty>
                      <CommandGroup heading="Vehicles">
                        {filteredVehicles.map((v) => {
                          const id = v.id;
                          const checked = selectedVehicleIds.includes(id);
                          const label = v.label || id;
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
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={handleNew} disabled={busy} className="gap-2">
              <Plus className="h-4 w-4" />
              New
            </Button>
            <Button
              onClick={handleSave}
              disabled={busy || !runName.trim() || !siteIds.length || !depotId}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              {selectedRun ? (isDirty ? "Save changes" : "Save") : "Create"}
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveAs}
              disabled={busy || !siteIds.length || !depotId}
              className="gap-2"
            >
              <Copy className="h-4 w-4" />
              Save as…
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy || !selectedRun} className="gap-2">
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            {isDirty && selectedRun && (
              <span className="ml-2 text-xs text-muted-foreground">Unsaved changes</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add site combobox (before selected list) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4 text-muted-foreground" aria-hidden />
            Add a site
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Popover open={isAddOpen} onOpenChange={setIsAddOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                Add a site…
                <kbd className="ml-2 rounded border bg-muted px-1 text-[10px]">⌄</kbd>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[420px] p-0" align="start">
              <Command>
                <CommandInput
                  placeholder="Search by name, city, address…"
                  value={addQuery}
                  onValueChange={setAddQuery}
                />
                <CommandList ref={addSiteListRef} className="max-h-64 overflow-y-auto">
                  <CommandEmpty>No results</CommandEmpty>
                  <CommandGroup heading="Available sites">
                    {availableSites
                      .filter((s) => {
                        const q = addQuery.trim().toLowerCase();
                        if (!q) return true;
                        const hay = `${s.name} ${getCity(s)} ${s.address ?? ""}`.toLowerCase();
                        return hay.includes(q);
                      })
                      .map((s) => (
                        <CommandItem
                          key={s.id}
                          value={`${s.name} ${getCity(s)} ${s.address ?? ""}`}
                          onSelect={() => addSite(s.id)}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{s.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {getCity(s)} {s.address ? `· ${s.address}` : ""}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>

      {/* Selected sites with per-site vehicle assignment */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
            Selected sites (ordered)
            <span className="text-xs font-normal text-muted-foreground">({siteIds.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-3 pb-2">
            <div />
            <div className="flex items-center gap-2">
              <Input
                placeholder="Filter selected…"
                value={selectedFilter}
                onChange={(e) => setSelectedFilter(e.target.value)}
                className="ml-3 h-8 w-56"
              />
              <Button variant="outline" size="sm" onClick={clearAllSites} disabled={!siteIds.length}>
                Remove all
              </Button>
            </div>
          </div>
          <Separator />
          <div ref={selectedSitesScrollRef} className="max-h-[360px] overflow-y-auto">
            <ul className="divide-y">
              {selectedSites.map((id) => {
                const index = siteIds.indexOf(id);
                const site = siteMap.get(id);
                const label = site?.name ?? id;
                const assigned = siteVehicleMap[id] ?? "";

                return (
                  <li key={id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border text-xs">
                          {index + 1}
                        </span>
                        <span className="truncate font-medium">{label}</span>
                      </div>
                      <p className="ml-8 truncate text-xs text-muted-foreground">
                        {getCity(site)} {site?.address ? `· ${site.address}` : ""}
                      </p>
                    </div>

                    {/* Per-site vehicle assignment */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-[220px]">
                        <Label className="sr-only">Vehicle</Label>
                        <Select
                          value={assigned ? assigned : NONE_VALUE}
                          onValueChange={(vid) => setVehicleForSite(id, vid === NONE_VALUE ? "" : vid)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Assign a vehicle…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE_VALUE}>— None —</SelectItem>

                            {/* Selected vehicles first */}
                            {selectedVehicleIds
                              .map((vid) => {
                                const v = allVehicleOptions.find((x) => x.id === vid);
                                return v ? (
                                  <SelectItem key={`sv-${v.id}`} value={v.id}>
                                    {v.label}
                                  </SelectItem>
                                ) : null;
                              })}

                            {/* Then the rest */}
                            {allVehicleOptions
                              .filter((v) => !selectedVehicleIds.includes(v.id))
                              .map((v) => (
                                <SelectItem key={`av-${v.id}`} value={v.id}>
                                  {v.label}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Button variant="ghost" size="icon" aria-label="Move up" onClick={() => moveUp(index)}>
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Move down" onClick={() => moveDown(index)}>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => removeSite(id)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
              {!selectedSites.length && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No sites in the current list.
                </li>
              )}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Helpers */
function getCity(s?: Site) {
  const withExtras = s as Site & {
    city?: { name?: string } | null;
    city_name?: string | null;
    country?: { code?: string } | null;
    country_code?: string | null;
  };
  const city = withExtras?.city?.name ?? withExtras?.city_name ?? "";
  const country = withExtras?.country?.code ?? withExtras?.country_code ?? "";
  return city ? (country ? `${city}, ${country}` : city) : "";
}

function renderCitySuffix(s?: Site) {
  if (!s) return "";
  const c = getCity(s);
  return c ? ` · ${c}` : "";
}

export default memo(MilkRunEditor);
