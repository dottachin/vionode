/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchVehicles,
  fetchDrivers,
  updateVehicle,
  updateDriver,
  deleteVehicle,
  deleteDriver,
} from "@/api/vehicles";
import { fetchSites } from "@/api/site";

import type { Vehicle, Driver } from "@/types/vehicle";
import type { Site } from "@/types/site";
import { normalizeCategory } from "@/utils/sanitizeOptimizerInput";
import VehicleList from "@/components/fleet/VehicleList";
import DriverList from "@/components/fleet/DriverList";
import VehicleForm from "@/components/fleet/VehicleForm";
import DriverForm from "@/components/fleet/DriverForm";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Truck, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

// dialog
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function FleetManager() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // dialogs
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [driverOpen, setDriverOpen] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);

  // loadData with "silent" option (no skeleton / no loading flip)
  const loadData = async (signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [v, d, s] = await Promise.all([fetchVehicles(), fetchDrivers(), fetchSites()]);
      if (signal?.aborted) return;
      setVehicles(v);
      setDrivers(d);
      setSites(s);
    } catch {
      if (!signal?.aborted) {
        const msg = "Could not load data. Please try again.";
        setError(msg);
        if (!silent) {
          toast.error("Loading error", { description: msg });
        }
      }
    } finally {
      if (!signal?.aborted && !silent) {
        setLoading(false);
      }
    }
  };

  // soft refresh helper (silent, with small debounce to let backend settle)
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const softRefresh = async (debounceMs = 250) => {
    setRefreshing(true);
    try {
      if (debounceMs > 0) await delay(debounceMs);
      await loadData(undefined, true); // silent = true
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
  controllerRef.current?.abort();
  const controller = new AbortController();
  controllerRef.current = controller;

  const toastId = "load-data"; // 👈 stable id
  toast.loading("Loading data…", { id: toastId });

  loadData(controller.signal, false)
    .then(() => {
      toast.success("Data loaded", { id: toastId });
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        toast.error("Error while loading", { id: toastId });
      }
    });

  return () => controller.abort();
}, []);


  const driverCount = drivers.length;
  const vehicleCount = vehicles.length;

  const headerSubtitle = useMemo(() => {
    const parts = [
      `${vehicleCount} vehicle${vehicleCount > 1 ? "s" : ""}`,
      `${driverCount} driver${driverCount > 1 ? "s" : ""}`,
    ];
    return parts.join(" · ");
  }, [vehicleCount, driverCount]);

  const depots = useMemo(
    () => sites.filter((s) => normalizeCategory(s.category) === "depot"),
    [sites]
  );

  // --- helpers ---
  const ensureStringIds = (updates: Record<string, unknown>) => {
    if ("driver_ids" in updates && Array.isArray((updates as any).driver_ids)) {
      (updates as any).driver_ids = (updates as any).driver_ids.map((x: any) => String(x));
    }
    return updates;
  };

  return (
    <div className="space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Truck className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
            Fleet management
            {refreshing && (
              <Loader2
                className="ml-2 h-5 w-5 animate-spin text-muted-foreground"
                aria-label="Refreshing in background"
              />
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{headerSubtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Create Vehicle (Dialog) */}
          <Dialog open={vehicleOpen} onOpenChange={setVehicleOpen}>
            <DialogTrigger asChild>
              <Button type="button" className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New vehicle
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[640px]">
              <DialogHeader>
                <DialogTitle>Add a vehicle</DialogTitle>
                <DialogDescription>Enter the vehicle details.</DialogDescription>
              </DialogHeader>
              <div className="pt-2">
                <VehicleForm
                  drivers={drivers} // avoid refetch inside form
                  depots={depots}
                  onCreated={async (created?: Vehicle) => {
                    if (created && created.id_vehicule) {
                      setVehicles((prev) => [created, ...prev]);
                    }
                    toast.success("Vehicle created");
                    setVehicleOpen(false);
                    // Soft reload to sync with server (silent)
                    await softRefresh();
                  }}
                />
              </div>
            </DialogContent>
          </Dialog>

          {/* Create Driver (Dialog) */}
          <Dialog open={driverOpen} onOpenChange={setDriverOpen}>
            <DialogTrigger asChild>
              <Button type="button" className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New driver
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[560px]">
              <DialogHeader>
                <DialogTitle>Add a driver</DialogTitle>
                <DialogDescription>Enter the driver details.</DialogDescription>
              </DialogHeader>
              <div className="pt-2">
                <DriverForm
                  onCreated={async (created?: Driver) => {
                    if (created && created.id) {
                      setDrivers((prev) => [created, ...prev]);
                    }
                    toast.success("Driver created");
                    setDriverOpen(false);
                    // Soft reload to sync vehicles list with potential availability rules
                    await softRefresh();
                  }}
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Vehicles */}
      <section aria-labelledby="vehicles-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="vehicles-heading" className="text-2xl font-semibold">Vehicles</h2>
        </div>

        {loading ? (
          <VehicleListSkeleton />
        ) : error ? (
          <Card aria-live="polite">
            <CardContent className="p-6">
              <p className="text-sm text-red-600">{error}</p>
            </CardContent>
          </Card>
        ) : vehicleCount === 0 ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">
                No vehicles yet. Click <b>New vehicle</b> to add one.
              </p>
            </CardContent>
          </Card>
        ) : (
          <VehicleList
            vehicles={vehicles}
            drivers={drivers}
            depots={depots}
            onUpdate={async (id, rawUpdates) => {
              // normalize to string IDs if present
              const updates = ensureStringIds({ ...(rawUpdates as any) });

              // optimistic update (compare as strings)
              setVehicles((prev) =>
                prev.map((v) =>
                  String(v.id_vehicule) === String(id) ? ({ ...v, ...updates } as Vehicle) : v
                )
              );

              try {
                await updateVehicle(Number(id), updates as any);
                toast.success("Vehicle updated");
                // Soft reload in background to reconcile with server state
                await softRefresh();
              } catch (err) {
                // rollback by refetching (visible)
                await loadData(undefined, false);
                toast.error("Update failed", {
                  description: "The vehicle change was not saved.",
                });
                console.error(err);
              }
            }}
            onDelete={async (id) => {
              // optimistic remove
              setVehicles((prev) => prev.filter((v) => String(v.id_vehicule) !== String(id)));
              try {
                await deleteVehicle(Number(id));
                toast.success("Vehicle deleted");
                await softRefresh();
              } catch (e) {
                await loadData(undefined, false); // rollback
                toast.error("Delete failed", {
                  description: "Could not delete the vehicle.",
                });
                console.error(e);
              }
            }}
          />
        )}
      </section>

      {/* Drivers */}
      <section aria-labelledby="drivers-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="drivers-heading" className="text-2xl font-semibold">Drivers</h2>
        </div>

        {loading ? (
          <DriverListSkeleton />
        ) : error ? (
          <Card aria-live="polite">
            <CardContent className="p-6">
              <p className="text-sm text-red-600">{error}</p>
            </CardContent>
          </Card>
        ) : drivers.length === 0 ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">
                No drivers yet. Click <b>New driver</b> to add one.
              </p>
            </CardContent>
          </Card>
        ) : (
          <DriverList
            drivers={drivers}
            vehicles={vehicles}
            onUpdate={async (id, updates) => {
              // optimistic update
              setDrivers((prev) =>
                prev.map((d) =>
                  String(d.id) === String(id) ? ({ ...d, ...updates } as Driver) : d
                )
              );
              try {
                await updateDriver(Number(id), updates);
                toast.success("Driver updated");
                await softRefresh();
              } catch (e) {
                await loadData(undefined, false); // rollback
                toast.error("Update failed", {
                  description: "The driver change was not saved.",
                });
                console.error(e);
              }
            }}
            onDelete={async (id) => {
              // optimistic remove
              setDrivers((prev) => prev.filter((d) => String(d.id) !== String(id)));
              try {
                await deleteDriver(Number(id));
                toast.success("Driver deleted");
                // Vehicles might reference this driver; refresh to reconcile
                await softRefresh();
              } catch (e) {
                await loadData(undefined, false); // rollback
                toast.error("Delete failed", {
                  description: "Could not delete the driver.",
                });
                console.error(e);
              }
            }}
          />
        )}
      </section>
    </div>
  );
}

/** Skeleton grid for initial load (vehicles) */
function VehicleListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <CardContent className="space-y-4 p-6">
            <div className="space-y-2">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
            <Skeleton className="h-5 w-24" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Simple skeleton for drivers */
function DriverListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <CardContent className="space-y-4 p-6">
            <div className="space-y-2">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
            <div className="grid grid-cols-1 gap-3">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
