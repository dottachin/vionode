// app/(dashboard)/sites/SiteManager.tsx
import { useEffect, useState, useCallback, useRef } from "react";
import { fetchSites, updateSite } from "@/api/site";
import type { Site } from "@/types/site";

import SiteForm from "@/components/sites/SiteForm";
import SiteList, { type SiteUpdate } from "@/components/sites/SiteList";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MapPin, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function SiteManager() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // dialog for create
  const [createOpen, setCreateOpen] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);

  const loadSites = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchSites();
      if (signal?.aborted) return;
      setSites(data);
    } catch (e) {
      if (!signal?.aborted) {
        console.error("Failed to fetch sites", e);
        const msg = "Could not load sites. Please try again.";
        setError(msg);
        toast.error("Loading error", { description: msg });
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
useEffect(() => {
  const controller = new AbortController();
  controllerRef.current = controller;

  const p = loadSites(controller.signal);

  const toastId = "load-sites";

  toast.loading("Loading sites…", { id: toastId });

  p.then(() => {
    toast.success("Sites loaded", { id: toastId });
  }).catch((err) => {
    if (err.name !== "AbortError") {
      toast.error("Error while loading", { id: toastId });
    }
  });

  return () => controller.abort();
}, [loadSites]);


  async function handleUpdate(id: string, updates: SiteUpdate) {
    const current = sites.find((s) => s.id === id);
    if (!current) return;

    const apiUpdates: Partial<Site> = {
      name: updates.name,
      category: updates.category,
      address: updates.address,
      service_time: updates.service_time,
      operational_hours: updates.operational_hours
        ? {
            start: updates.operational_hours.start ?? current.operational_hours?.start ?? "",
            end: updates.operational_hours.end ?? current.operational_hours?.end ?? "",
          }
        : undefined,
    };

    const lat = updates.coordinates?.latitude ?? current.coordinates?.latitude;
    const lon = updates.coordinates?.longitude ?? current.coordinates?.longitude;
    if (typeof lat === "number" && typeof lon === "number") {
      apiUpdates.coordinates = { latitude: lat, longitude: lon };
    }

    setSaving(true);
    // optimistic update
    setSites((curr) => curr.map((s) => (s.id === id ? ({ ...s, ...apiUpdates } as Site) : s)));

    try {
      await updateSite(id, apiUpdates);
      toast.success("Site updated");
    } catch (e) {
      console.error("Update site failed", e);
      setError("Site update failed. Data restored.");
      toast.error("Update failed", {
        description: "Local data has been restored.",
      });
      // rollback by refetching
      await loadSites();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8 px-4 py-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <MapPin className="h-6 w-6 text-muted-foreground" aria-hidden />
          <div>
            <h1 className="text-3xl font-bold">Site management</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create, view and update operational sites.
            </p>
          </div>
        </div>

        {/* Create site (Dialog) */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button type="button" className="inline-flex items-center gap-2">
              <Plus className="h-4 w-4" aria-hidden />
              New site
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[640px]">
            <DialogHeader>
              <DialogTitle>Add a site</DialogTitle>
              <DialogDescription>Fill in the details below.</DialogDescription>
            </DialogHeader>
            <div className="pt-2">
              <SiteForm
                onCreated={(site) => {
                  // Optimistically add new site to the top
                  setSites((prev) => [site, ...prev]);
                  toast.success("Site created");
                  setCreateOpen(false);
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* TABLE FIRST */}
      <section aria-labelledby="sites-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="sites-heading" className="text-2xl font-semibold">Sites</h2>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <SiteListSkeleton />
        ) : sites.length === 0 ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">
                No sites yet. Click <b>New site</b> to add one.
              </p>
            </CardContent>
          </Card>
        ) : (
          <SiteList
            sites={sites} // ← pass FULL list; SiteList handles search + pagination internally
            onUpdate={handleUpdate}
            initialPageSize={10}
          />
        )}

        {saving && <p className="text-xs text-muted-foreground">Saving changes…</p>}
      </section>
    </div>
  );
}

/** Skeleton table for initial load */
function SiteListSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sites</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="w-full overflow-x-auto">
          <table className="w-full">
            <thead className="border-b">
              <tr className="text-left">
                {Array.from({ length: 9 }).map((_, i) => (
                  <th key={i} className="px-4 py-3 text-sm font-medium text-muted-foreground">
                    <Skeleton className="h-4 w-24" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, r) => (
                <tr key={r} className="border-b">
                  {Array.from({ length: 9 }).map((_, c) => (
                    <td key={c} className="px-4 py-3">
                      <Skeleton className="h-4 w-[70%]" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
