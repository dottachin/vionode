// src/pages/OrderManager.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import type { Order } from "@/types/order";
import type { OrderSet } from "@/types/order";
import type { Site } from "@/types/site";
import type { Vehicle, Driver } from "@/types/vehicle";
import type {
  OptimizerInput,
  OptimizerResult,
  Metrics,
  OptimizationCreate,
} from "@/types/optimizer";

import {
  saveOrderSet,
  fetchOrderSets,
  loadOrderSet,
  deleteOrderSet,
} from "@/api/order_sets";
import { fetchSites } from "@/api/site";
import { fetchVehicles, fetchDrivers } from "@/api/vehicles";
import { optimizeRoutes } from "@/api/optimizer";
import { saveOptimization } from "@/api/optimizations"; // <- static import
import { TempSiteDialog } from "@/components/sites/TempSiteDialog";

import OrderForm from "@/components/orders/OrderForm";
import OrderList from "@/components/orders/OrderList";

import OptimizerForm from "@/components/optimizer/OptimizerForm";
import SpinnerWithText from "@/components/ui/SpinnerWithText";
import OptimizerResults from "@/components/optimizer/OptimizerResults";
import ResultSummary from "@/components/optimizer/ResultSummary";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Package,
  Save,
  Plus,
  FolderOpen,
  Trash2,
  Route as RouteIcon,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ---------------- Progress helper mirroring backend timeouts ---------------- */
const MODE_PROGRESS_HINT: Record<string, number> = {
  fast: 30,
  balanced: 140,
  optimal: 340,
};

const PAGE_SIZE = 10;

/** convert km → meters (skip invalid/zero/negative) */
const toMetersFromKm = (km: unknown) => {
  const n = Number(km);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : undefined;
};

export default function OrderManager() {
  // ---- Orders + Sets ----
  const [orders, setOrders] = useState<Order[]>([]);
  const [setName, setSetName] = useState("");
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);

  const [sets, setSets] = useState<OrderSet[]>([]);
  const [setsLoading, setSetsLoading] = useState(false);
  const [setsError, setSetsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // delete confirm dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OrderSet | null>(null);

  // ---- Optimizer ----
  const [sites, setSites] = useState<Site[]>([]);
  const [tempSites, setTempSites] = useState<Site[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [loading, setLoading] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);

  // store last optimized data for explicit save
  const [lastOptimMetrics, setLastOptimMetrics] = useState<Metrics | null>(null);
  const [lastOptimResult, setLastOptimResult] = useState<OptimizerResult | null>(null);
  const [lastDepotId, setLastDepotId] = useState<string | null>(null);
  const [lastSiteIds, setLastSiteIds] = useState<string[] | null>(null);
  const [lastHasTempSites, setLastHasTempSites] = useState(false);
  const [lastParams, setLastParams] = useState<{
    optimization_arc: any;
    solver_mode: any;
    slack_time_seconds: number;
  } | null>(null);
  const [lastVehicleIds, setLastVehicleIds] = useState<string[] | null>(null);

  // saving flag for OptimizerResults Save button
  const [saving, setSaving] = useState(false);

  /* --------------------------- progress UI state --------------------------- */
  const [progressPct, setProgressPct] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [expectedSec, setExpectedSec] = useState<number | null>(null);
  const [currentMode, setCurrentMode] = useState<string | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    refreshSets();
  }, []);

  async function refreshSets() {
    setSetsError(null);
    setSetsLoading(true);
    try {
      const data = await fetchOrderSets();
      setSets(data || []);
      setPage(1);
    } catch (e) {
      console.error(e);
      const msg = "Impossible de charger les lots.";
      setSetsError(msg);
      toast.error("Erreur de chargement", { description: msg });
    } finally {
      setSetsLoading(false);
    }
  }

  const addOrder = (order: Order) => {
    const unique = { ...order, id: order.id || uuidv4() };
    setOrders((prev) => [...prev, unique]);
    toast.success("Commande ajoutée", { description: unique.id });
  };

  const deleteOrder = (id: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== id));
    toast.info("Commande supprimée", { description: id });
  };

  const handleSaveSet = async () => {
    if (!setName.trim()) {
      toast.warning("Nom requis", { description: "Donnez un nom au lot de commandes." });
      return;
    }
    if (orders.length === 0) {
      toast.warning("Aucune commande", { description: "Ajoutez des commandes avant d’enregistrer." });
      return;
    }

    const p = saveOrderSet(setName.trim(), orders);
    toast.promise(p, {
      loading: "Enregistrement du lot…",
      success: "Lot enregistré avec succès",
      error: "Erreur lors de l’enregistrement",
    });

    try {
      const saved = await p;
      setSelectedSetId(saved?.id ?? null);
      await refreshSets();
    } catch (err) {
      console.error("Erreur enregistrement", err);
    }
  };

  const handleLoadSet = async (id: OrderSet["id"]) => {
    try {
      const s = await loadOrderSet(id);
      setOrders(s.orders || []);
      setSelectedSetId(s.id ?? null);
      toast.success("Lot chargé", {
        description: `${s.name} (${s.orders?.length ?? 0} commandes)`,
      });
      setSetName(s.name ?? "");
    } catch (e) {
      console.error(e);
      toast.error("Échec du chargement du lot");
    }
  };

  // delete an order set
  const handleDeleteSet = async () => {
    if (!deleteTarget?.id) return;
    try {
      const p = deleteOrderSet(deleteTarget.id);
      toast.promise(p, {
        loading: "Suppression du lot…",
        success: "Lot supprimé",
        error: "Échec de la suppression du lot",
      });
      await p;

      if (selectedSetId === deleteTarget.id) {
        setSelectedSetId(null);
        setOrders([]);
        setSetName("");
        setResult(null);
      }

      await refreshSets();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  // ---- Initial data load for optimization ----
  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const load = async () => {
      try {
        await Promise.all([
          fetchSites().then(setSites),
          fetchDrivers().then(setDrivers),
          fetchVehicles().then(setVehicles),
        ]);
      } catch (_err) {
        if (!controller.signal.aborted) {
          toast.error("Erreur de chargement", {
            description: "Impossible de récupérer sites / véhicules / chauffeurs.",
          });
        }
      }
    };

    load();
    return () => controller.abort();
  }, []);

  // ---- Submit to solver (no auto-save) ----
  const handleSubmit = async (input: OptimizerInput) => {
    if (!input.depots || input.depots.length === 0) {
      toast.error("Aucun depot", { description: "Ajoutez au moins un depot avant de lancer l'optimisation." });
      return;
    }

    let fixedInput: OptimizerInput = {
      ...input,
      orders: input.orders.map((o) => ({
        ...o,
        order_id: o.order_id && o.order_id.trim() ? o.order_id : uuidv4(),
      })),
    };

    // >>> Inject max_distance_meters derived from max_distance (km) ONLY here
    if (Array.isArray(fixedInput.vehicles) && fixedInput.vehicles.length > 0) {
      fixedInput = {
        ...fixedInput,
        vehicles: (fixedInput.vehicles as any[]).map((v: any) => {
          const maxMeters = v.max_distance_meters ?? toMetersFromKm(v.max_distance);
          return {
            ...v,
            ...(typeof maxMeters === "number" ? { max_distance_meters: maxMeters } : {}),
            depot_id: undefined,
          };
        }),
      };
    }

    // Reset UI
    setLoading(true);
    setResult(null);
    setLastOptimMetrics(null);
    setLastOptimResult(null);
    setLastHasTempSites(false);
    setLastDepotId(null);
    setLastSiteIds(null);
    setLastParams(null);
    setLastVehicleIds(null);

    // start progress helper
    const mode = String(fixedInput.solver_mode || "balanced");
    const expected = MODE_PROGRESS_HINT[mode] ?? 60;
    const startedAt = Date.now();

    setCurrentMode(mode);
    setExpectedSec(expected);
    setElapsedSec(0);
    setProgressPct(0);

    if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      setElapsedSec(elapsed);
      const pct = Math.min(99, Math.floor((elapsed / expected) * 100));
      setProgressPct(pct);
    }, 200);

    try {
      const p = optimizeRoutes(fixedInput);
      toast.promise(p, {
        loading: "Optimisation en cours…",
        success: "Optimisation terminée",
        error: "Erreur lors de l’optimisation",
      });
      const res = await p;

      setProgressPct(100);
      setResult(res.result);

      // compute depot/site_ids for save payload
      const allSiteIds = new Set<string>();
      for (const dep of fixedInput.depots || []) {
        if (dep?.id) allSiteIds.add(dep.id);
      }
      for (const ord of fixedInput.orders) {
        if (ord.source?.id) allSiteIds.add(ord.source.id);
        if (ord.destination?.id) allSiteIds.add(ord.destination.id);
      }
      const site_ids = Array.from(allSiteIds);
      const depot_id =
        fixedInput.depots?.[0]?.id ||
        fixedInput.orders[0]?.source?.id ||
        site_ids[0] ||
        "unknown";

      const m: Metrics =
        (res as any).metrics ??
        res.result?.metrics ?? {
          solve_time: 0,
          total_distance: 0,
          total_vehicles_used: 0,
          unassigned_orders: 0,
          surface_utilization: 0,
          weight_utilization: 0,
          total_co2_emissions_kg: 0,
          avg_co2_per_km_kg: 0,
          virtual_sites_reverted: 0,
        };

      const vehicleIdsUsed =
        (fixedInput.vehicles || [])
          .map((v: any) => v?.id_vehicule ?? v?.id ?? String(v))
          .filter((x: any) => typeof x === "string" && x.length > 0);

      setLastDepotId(depot_id);
      setLastSiteIds(site_ids);
      setLastHasTempSites(site_ids.some((id) => String(id).startsWith("temp-")));
      setLastOptimMetrics(m);
      setLastOptimResult(res.result ?? null);
      setLastParams({
        optimization_arc: fixedInput.optimization_arc,
        solver_mode: fixedInput.solver_mode,
        slack_time_seconds: fixedInput.slack_time_seconds,
      });
      setLastVehicleIds(vehicleIdsUsed);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    }
  };

  // Save handler used by OptimizerResults
  const handleSaveFromResults = async (name: string) => {
    if (lastHasTempSites) {
      toast.error("Impossible de sauvegarder", { description: "Enregistrez d'abord les sites temporaires." });
      return;
    }
    if (!selectedSetId) {
      toast.info("Lot non sélectionné", {
        description: "Sélectionnez un Order Set (ou lancez depuis un lot sauvegardé).",
      });
      return;
    }
    if (!lastOptimMetrics || !lastDepotId || !lastSiteIds || !lastParams) {
      toast.error("Données insuffisantes pour sauvegarder");
      return;
    }

    const vehicle_ids =
      (lastVehicleIds && lastVehicleIds.length > 0)
        ? lastVehicleIds
        : (vehicles || []).map((v: any) => v?.id_vehicule).filter(Boolean);

    const payload: OptimizationCreate = {
      name: name?.trim() || null,
      milk_run_id: null,
      order_set_id: selectedSetId,
      depot_id: lastDepotId,
      site_ids: lastSiteIds,
      params: lastParams as any,
      metrics: lastOptimMetrics,
      result: lastOptimResult,
      solver_run_id: null,
      result_id: null,
      note: "optimized",
      vehicle_ids: vehicle_ids as any,
    };

    try {
      setSaving(true);
      await saveOptimization(payload);
      toast.success("Optimisation sauvegardée");
    } catch (dbErr) {
      console.error(dbErr);
      toast.error("Échec de la sauvegarde de l’optimisation", {
        description: "Vérifiez le backend DB.",
      });
    } finally {
      setSaving(false);
    }
  };

  // pagination
  const totalPages = Math.max(1, Math.ceil((sets?.length || 0) / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const current = sets.slice(start, start + PAGE_SIZE);
  const allSites = useMemo(() => [...sites, ...tempSites], [sites, tempSites]);

  return (
    <div className="space-y-10 px-4 py-6">
      <div className="surface-card-padded">
        {/* Header + actions */}
        <header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Package className="h-6 w-6 text-muted-foreground" aria-hidden />
          <h1 className="text-3xl font-bold">Création de commandes</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button type="button" className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" aria-hidden />
                Nouvelle commande
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[640px]">
              <DialogHeader>
                <DialogTitle>Ajouter une commande</DialogTitle>
                <DialogDescription>
                  Renseignez les informations ci-dessous.
                </DialogDescription>
              </DialogHeader>
              <div className="pt-2">
                <OrderForm
                  allSites={allSites}
                  onAdd={(order) => {
                    addOrder(order);
                    setCreateOpen(false);
                  }}
                  onAddAndStay={(order) => {
                    addOrder(order);
                    toast.success("Commande ajoutée (vous pouvez en ajouter une autre)");
                  }}
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>
      </div>

      {/* CURRENT ORDERS */}
      <section aria-labelledby="orders-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="orders-heading" className="text-2xl font-semibold">
            Commandes
          </h2>
          <TempSiteDialog
            trigger={
              <Button
                variant="outline"
                className="inline-flex items-center gap-2 border-border/70 ring-1 ring-primary/20 shadow-sm"
                aria-label="Ajouter un site temporaire"
                title="Ajouter un site temporaire"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Ajouter un site temporaire
              </Button>
            }
            onCreate={(site) => setTempSites((prev) => [...prev, site])}
          />
        </div>
        <OrderList orders={orders} onDelete={deleteOrder} sites={allSites} />
      </section>

      {/* Save set controls */}
      <div className="space-y-4">
        <Separator />
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <Label htmlFor="set-name" className="mb-2 block">
              Nom du lot à sauvegarder
            </Label>
            <Input
              id="set-name"
              placeholder="Ex : Livraison jour A"
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
            />
          </div>
          <Button onClick={handleSaveSet} className="gap-2">
            <Save className="h-4 w-4" aria-hidden />
            Sauvegarder le lot
          </Button>
        </div>
      </div>

      {/* SAVED ORDER SETS */}
      <section aria-labelledby="sets-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="sets-heading" className="text-2xl font-semibold">
            Lots enregistrés
          </h2>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead className="whitespace-nowrap">Créé le</TableHead>
                    <TableHead className="text-center"># commandes</TableHead>
                    <TableHead className="w-[10%] text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {setsError ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-red-600">
                        {setsError}
                      </TableCell>
                    </TableRow>
                  ) : setsLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="py-6">Chargement…</TableCell>
                        <TableCell className="py-6" />
                        <TableCell className="py-6" />
                        <TableCell className="py-6" />
                      </TableRow>
                    ))
                  ) : current.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        Aucun lot enregistré.
                      </TableCell>
                    </TableRow>
                  ) : (
                    current.map((s) => {
                      const count = s.orders?.length ?? 0;
                      const created = s.created_at ? new Date(s.created_at) : null;
                      const isActive = selectedSetId === s.id;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.name}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {created ? created.toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="text-center">{count}</TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-2"
                                onClick={() => handleLoadSet(s.id)}
                              >
                                <FolderOpen className="h-4 w-4" aria-hidden />
                                Charger
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => {
                                  setDeleteTarget(s);
                                  setDeleteOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                                Supprimer
                              </Button>
                              {isActive && (
                                <span className="ml-2 rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                  Actif
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {page} / {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(1)}
              disabled={page === 1 || setsLoading}
            >
              « Première
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || setsLoading}
            >
              ‹ Précédente
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || setsLoading}
            >
              Suivante ›
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages || setsLoading}
            >
              Dernière »
            </Button>
          </div>
        </div>
      </section>

      {/* Optimizer */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <RouteIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h2 className="text-2xl font-semibold">Optimisation de tournées</h2>
        </div>
        {/* Form AFTER results */}
        <OptimizerForm
          inMemoryOrders={orders}
          drivers={drivers}
          vehicles={vehicles}
          sites={allSites}
          onSubmit={handleSubmit}
          // keep the selected set synced when running from "Lot sauvegardé"
          onSourceChange={(mode) => {
            if (mode !== "saved") setSelectedSetId(null);
          }}
          onSavedSetChange={(id) => {
            setSelectedSetId(id);
          }}
        />

        {/* 🔼 Results FIRST (before the form) */}
        {loading && (
          <div className="grid place-items-center py-6">
            <SpinnerWithText
              label="Optimisation en cours…"
              progressPct={progressPct}
              elapsedSec={elapsedSec}
              expectedSec={expectedSec ?? undefined}
              mode={currentMode ?? undefined}
              finalizing={progressPct >= 99}
            />
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <ResultSummary
              result={result}
              title="Résumé de l'optimisation"
              description="Principaux indicateurs de la tournée."
            />
            <OptimizerResults
              result={result}
              sites={allSites}
              vehicles={vehicles}   // enables vehicle label display
              drivers={drivers}     // enables driver name display
              defaultName={
                lastParams
                  ? `OS • ${String(lastParams.optimization_arc)}/${String(lastParams.solver_mode)}`
                  : undefined
              }
              saving={saving}
              onSave={handleSaveFromResults}
            />
          </div>
        )}
      </section>

      {/* Delete confirm dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce lot ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                <>
                  Cette action est irréversible. Le lot <b>{deleteTarget.name}</b> sera supprimé
                  définitivement. Les commandes du lot ne seront plus accessibles via la liste des lots.
                </>
              ) : (
                "Cette action est irréversible."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDeleteSet}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
