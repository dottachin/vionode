// @/components/fleet/SiteList.tsx
import { memo, useEffect, useMemo, useState } from "react";
import type { Site } from "@/types/site";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Pencil } from "lucide-react";

// ---------- Types ----------

type SiteFormState = {
  name: string;
  category: string;
  address: string;
  coordinates?: {
    latitude?: number;
    longitude?: number;
  };
  /** UI field in hh:mm; converted to seconds for API on save */
  service_hhmm: string;
  operational_hours: {
    start: string;
    end: string;
  };
};

export type SiteUpdate = Partial<Omit<Site, "coordinates" | "operational_hours">> & {
  coordinates?: {
    latitude?: number;
    longitude?: number;
  };
  operational_hours?: {
    start: string;
    end: string;
  };
};

// ---------- Helpers ----------
const DEFAULT_CATEGORIES = [
  "ATELIER",
  "COMPOSANT",
  "DEPOT",
  "FACONNIER",
  "FOURNISSEUR",
  "ATELIER ITALIEN",
  "FOURNISSEUR EXW",
  "HUB",
  "FOURNISSEUR EXW ITALIEN",
  "FOURNISSEUR ITALIEN",
];

function normalizeHours(oh?: Site["operational_hours"]) {
  return { start: oh?.start ?? "", end: oh?.end ?? "" };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Format seconds (number) to "HH:MM" (clamped to 23:59 for display) */
function secondsToHHMM(sec?: number): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const hh = String(Math.min(hours, 23)).padStart(2, "0");
  const mm = String(Math.min(minutes, 59)).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Parse "HH:MM" (or "H:MM") to seconds; returns undefined if invalid */
function hhmmToSeconds(v: string): number | undefined {
  const m = v.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return undefined;
  return h * 3600 + mm * 60;
}

type Props = {
  /** IMPORTANT: pass the FULL list (not a single page). */
  sites: Site[];
  onUpdate?: (id: string, updates: SiteUpdate) => Promise<void> | void;
  /** Optional override list for categories */
  categories?: string[];
  /** Optional: initial page size */
  initialPageSize?: number;
};

function SiteList({ sites, onUpdate, categories, initialPageSize = 10 }: Props) {
  const CATS = useMemo(() => (categories?.length ? categories : DEFAULT_CATEGORIES), [categories]);

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const nf = useMemo(() => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 }), []);

  // Filter FIRST (search across the full dataset)
  const filteredSites = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter((s) =>
      (s.name ?? "").toLowerCase().includes(q) ||
      (s.category ?? "").toLowerCase().includes(q) ||
      (s.address ?? "").toLowerCase().includes(q)
    );
  }, [sites, query]);

  // Reset page when query or pageSize changes
  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  // Then paginate the filtered result
  const total = filteredSites.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = clamp(page, 1, pageCount);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filteredSites.slice(startIdx, endIdx);

  if (!sites?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground" aria-hidden />
            Sites
          </CardTitle>
          <CardDescription>Aucun site disponible.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground" aria-hidden />
            Sites
          </CardTitle>
          {/* Page size selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:inline">Par page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => setPageSize(parseInt(v, 10))}
            >
              <SelectTrigger className="w-[90px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <CardDescription>Recherche globale + pagination locale.</CardDescription>
      </CardHeader>

      <CardContent className="p-0">
        {/* Search Input */}
        <div className="p-3">
          <Input
            placeholder="Rechercher par nom, catégorie ou adresse…"
            aria-label="Recherche"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* Meta line */}
          <div className="mt-2 text-xs text-muted-foreground">
            {total
              ? `Affichage ${startIdx + 1}–${endIdx} sur ${total} résultat${total > 1 ? "s" : ""}`
              : "Aucun résultat"}
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Catégorie</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead className="text-right">Latitude</TableHead>
                <TableHead className="text-right">Longitude</TableHead>
                <TableHead className="text-right">Chargement/Déchargement</TableHead>
                <TableHead className="text-right">Ouverture</TableHead>
                <TableHead className="text-right">Fermeture</TableHead>
                <TableHead className="w-[1%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.category || "—"}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate" title={s.address}>
                    {s.address || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {typeof s.coordinates?.latitude === "number" ? nf.format(s.coordinates.latitude) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {typeof s.coordinates?.longitude === "number" ? nf.format(s.coordinates.longitude) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {typeof s.service_time === "number" ? secondsToHHMM(s.service_time) : "—"}
                  </TableCell>
                  <TableCell className="text-right">{s.operational_hours?.start || "—"}</TableCell>
                  <TableCell className="text-right">{s.operational_hours?.end || "—"}</TableCell>
                  <TableCell className="text-right">
                    <EditSiteDialog
                      site={s}
                      categories={CATS}
                      onSave={async (updates) => onUpdate?.(s.id, updates)}
                    >
                      <Button size="sm" variant="ghost" className="gap-2">
                        <Pencil className="h-4 w-4" />
                        Modifier
                      </Button>
                    </EditSiteDialog>
                  </TableCell>
                </TableRow>
              ))}
              {!pageItems.length && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-4">
                    {query
                      ? <>Aucun site ne correspond à « {query} ».</>
                      : "Aucun site à afficher."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination controls */}
        <div className="flex items-center justify-between px-3 py-3 border-t">
          <div className="text-xs text-muted-foreground">
            Page {safePage} / {pageCount}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(1)}
              disabled={safePage === 1}
            >
              «
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => clamp(p - 1, 1, pageCount))}
              disabled={safePage === 1}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => clamp(p + 1, 1, pageCount))}
              disabled={safePage === pageCount}
            >
              Suivant
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(pageCount)}
              disabled={safePage === pageCount}
            >
              »
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EditSiteDialog({
  site,
  onSave,
  categories,
  children,
}: {
  site: Site;
  onSave: (updates: SiteUpdate) => Promise<void> | void;
  categories?: string[]; // pre-resolved by parent to CATS
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SiteFormState>(() => ({
    name: site.name ?? "",
    category: site.category ?? "",
    address: site.address ?? "",
    coordinates: {
      latitude: site.coordinates?.latitude,
      longitude: site.coordinates?.longitude,
    },
    service_hhmm: secondsToHHMM(site.service_time),
    operational_hours: normalizeHours(site.operational_hours),
  }));

  const setNumCoord = (path: "latitude" | "longitude", raw: string) => {
    const clean = raw.trim() === "" ? undefined : Number(raw.replace(",", "."));
    setForm((f) => ({
      ...f,
      coordinates: {
        ...(f.coordinates ?? {}),
        [path]: Number.isFinite(clean) ? (clean as number) : undefined,
      },
    }));
  };

  const latOK =
    form.coordinates?.latitude === undefined ||
    (form.coordinates.latitude >= -90 && form.coordinates.latitude <= 90);
  const lonOK =
    form.coordinates?.longitude === undefined ||
    (form.coordinates.longitude >= -180 && form.coordinates.longitude <= 180);

  async function handleSave() {
    setSaving(true);
    try {
      const sec = hhmmToSeconds(form.service_hhmm);

      const updates: SiteUpdate = {
        name: form.name.trim() || undefined,
        category: form.category.trim() || undefined,
        address: form.address.trim() || undefined,
        coordinates:
          form.coordinates?.latitude !== undefined || form.coordinates?.longitude !== undefined
            ? { latitude: form.coordinates?.latitude, longitude: form.coordinates?.longitude }
            : undefined,
        service_time: typeof sec === "number" && sec >= 0 ? sec : undefined,
        operational_hours:
          form.operational_hours.start || form.operational_hours.end
            ? { start: form.operational_hours.start, end: form.operational_hours.end }
            : undefined,
      };

      await onSave(updates);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setForm({
            name: site.name ?? "",
            category: site.category ?? "",
            address: site.address ?? "",
            coordinates: {
              latitude: site.coordinates?.latitude,
              longitude: site.coordinates?.longitude,
            },
            service_hhmm: secondsToHHMM(site.service_time),
            operational_hours: normalizeHours(site.operational_hours),
          });
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Modifier le site</DialogTitle>
          <DialogDescription>ID : {site.id}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">Nom</Label>
            <Input
              id="name"
              className="col-span-3"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="category" className="text-right">Catégorie</Label>
            <Select
              value={form.category}
              onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
            >
              <SelectTrigger id="category" className="col-span-3">
                <SelectValue placeholder="Sélectionner…" />
              </SelectTrigger>
              <SelectContent>
                {(categories?.length ? categories : DEFAULT_CATEGORIES).map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="address" className="text-right">Adresse</Label>
            <Input
              id="address"
              className="col-span-3"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="lat" className="text-right">Latitude</Label>
            <Input
              id="lat"
              inputMode="decimal"
              className="col-span-3"
              value={form.coordinates?.latitude ?? ""}
              onChange={(e) => setNumCoord("latitude", e.target.value)}
              placeholder="ex: 33.5731"
              min={-90}
              max={90}
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="lng" className="text-right">Longitude</Label>
            <Input
              id="lng"
              inputMode="decimal"
              className="col-span-3"
              value={form.coordinates?.longitude ?? ""}
              onChange={(e) => setNumCoord("longitude", e.target.value)}
              placeholder="ex: -7.5898"
              min={-180}
              max={180}
            />
          </div>

          {!latOK || !lonOK ? (
            <div className="col-span-4 -mt-2 text-xs text-red-600">
              {(!latOK && "Latitude invalide (-90 à 90). ") || ""}
              {(!lonOK && "Longitude invalide (-180 à 180). ") || ""}
            </div>
          ) : null}

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="service" className="text-right">Chargement/Déchargement</Label>
            <Input
              id="service"
              type="time"
              step={60}
              className="col-span-3"
              value={form.service_hhmm}
              onChange={(e) => setForm((f) => ({ ...f, service_hhmm: e.target.value }))}
              placeholder="00:10"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="start" className="text-right">Ouverture</Label>
            <Input
              id="start"
              type="time"
              className="col-span-3"
              value={form.operational_hours.start}
              onChange={(e) => setForm((f) => ({
                ...f,
                operational_hours: { start: e.target.value, end: f.operational_hours.end },
              }))}
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="end" className="text-right">Fermeture</Label>
            <Input
              id="end"
              type="time"
              className="col-span-3"
              value={form.operational_hours.end}
              onChange={(e) => setForm((f) => ({
                ...f,
                operational_hours: { start: f.operational_hours.start, end: e.target.value },
              }))}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">Annuler</Button>
          </DialogClose>
          <Button type="button" onClick={handleSave} disabled={saving || !latOK || !lonOK}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default memo(SiteList);
