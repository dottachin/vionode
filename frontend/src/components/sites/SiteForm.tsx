import { SITE_CATEGORIES } from "@/constants/domain";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useMemo, useState } from "react";
import { createSite } from "@/api/site";
import type { Site } from "@/types/site";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Building2, Clock, PlusCircle } from "lucide-react";

type Props = {
  onCreated?: (site: Site) => void;
  /** Optional override list for categories (otherwise defaults below) */
  categories?: string[];
};

const DEFAULT_CATEGORIES: string[] = [...SITE_CATEGORIES];

// --- time helpers ---
const secondsToHHMM = (sec?: number) => {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(Math.min(h, 23)).padStart(2, "0")}:${String(Math.min(m, 59)).padStart(2, "0")}`;
};
const hhmmToSeconds = (v: string): number | undefined => {
  const m = v.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
};

function SiteForm({ onCreated, categories }: Props) {
  const CATS = useMemo(() => (categories?.length ? categories : DEFAULT_CATEGORIES), [categories]);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<{
    name: string;
    address: string;
    category: string;
    coordinates: { latitude?: number; longitude?: number };
    service_hhmm: string; // UI field (converted to seconds on submit)
    operational_hours: { start: string; end: string };
  }>({
    name: "",
    address: "",
    category: "",
    coordinates: { latitude: undefined, longitude: undefined },
    service_hhmm: secondsToHHMM(1800), // default 10 min
    operational_hours: { start: "08:00", end: "18:00" },
  });

  const setField = <K extends "name" | "address" | "category">(key: K, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setCoord = (key: "latitude" | "longitude", raw: string) => {
    const n = raw.trim() === "" ? undefined : Number(raw.replace(",", "."));
    setForm((prev) => ({
      ...prev,
      coordinates: {
        ...(prev.coordinates ?? {}),
        [key]: Number.isFinite(n) ? n : undefined,
      },
    }));
  };

  const setHour = (key: "start" | "end", value: string) =>
    setForm((prev) => ({
      ...prev,
      operational_hours: {
        ...(prev.operational_hours ?? { start: "08:00", end: "18:00" }),
        [key]: value,
      },
    }));

  const resetForm = () =>
    setForm({
      name: "",
      address: "",
      category: "",
      coordinates: { latitude: undefined, longitude: undefined },
      service_hhmm: secondsToHHMM(600),
      operational_hours: { start: "08:00", end: "18:00" },
    });

  const generateId = () =>
    (globalThis.crypto?.randomUUID?.() as string | undefined) ||
    `site_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const handleSubmit = async () => {
    if (!form.name.trim()) return;

    setBusy(true);
    try {
      const sec = hhmmToSeconds(form.service_hhmm);
      const payload: Partial<Site> = {
        id: generateId(), // ✅ generated client-side
        name: form.name.trim(),
        address: form.address.trim(),
        category: form.category || undefined,
        coordinates:
          form.coordinates.latitude !== undefined || form.coordinates.longitude !== undefined
            ? {
                latitude: form.coordinates.latitude ?? 0,
                longitude: form.coordinates.longitude ?? 0,
              }
            : undefined,
        service_time: typeof sec === "number" ? sec : undefined,
        operational_hours: { ...form.operational_hours },
      };

      const created = await createSite(payload);
      onCreated?.(created);
      resetForm();
    } catch (e) {
      console.error("Failed to create site:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlusCircle className="h-5 w-5 text-muted-foreground" aria-hidden />
          Add a site
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="site-name" className="mb-2 block">
            Name
          </Label>
          <Input
            id="site-name"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="e.g. East Warehouse"
          />
        </div>

        <div>
          <Label htmlFor="site-address" className="mb-2 block">
            Address
          </Label>
          <Input
            id="site-address"
            value={form.address}
            onChange={(e) => setField("address", e.target.value)}
            placeholder="e.g. 12 Boulevard Mohammed V, Casablanca"
          />
        </div>

        <div>
          <Label htmlFor="site-category" className="mb-2 block">
            Category
          </Label>
          <Select value={form.category} onValueChange={(v) => setField("category", v)}>
            <SelectTrigger id="site-category">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {CATS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="lat" className="mb-2 block">
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
                Latitude
              </span>
            </Label>
            <Input
              id="lat"
              type="number"
              inputMode="decimal"
              step="any"
              value={form.coordinates.latitude ?? ""}
              onChange={(e) => setCoord("latitude", e.target.value)}
              placeholder="ex: 45.7640"
            />
          </div>
          <div>
            <Label htmlFor="lng" className="mb-2 block">
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
                Longitude
              </span>
            </Label>
            <Input
              id="lng"
              type="number"
              inputMode="decimal"
              step="any"
              value={form.coordinates.longitude ?? ""}
              onChange={(e) => setCoord("longitude", e.target.value)}
              placeholder="ex: 4.8357"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="open" className="mb-2 block">
              <span className="inline-flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                Opening
              </span>
            </Label>
            <Input
              id="open"
              type="time"
              value={form.operational_hours.start}
              onChange={(e) => setHour("start", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="close" className="mb-2 block">
              <span className="inline-flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                Closing
              </span>
            </Label>
            <Input
              id="close"
              type="time"
              value={form.operational_hours.end}
              onChange={(e) => setHour("end", e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="service" className="mb-2 block">
            <span className="inline-flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
              Loading/Unloading
            </span>
          </Label>
          <Input
            id="service"
            type="time"
            step={60}
            value={form.service_hhmm}
            onChange={(e) => setForm((p) => ({ ...p, service_hhmm: e.target.value }))}
            placeholder="00:30"
          />
        </div>

        <Button className="mt-2 w-full gap-2" onClick={handleSubmit} disabled={busy}>
          <PlusCircle className="h-4 w-4" />
          {busy ? "Creating…" : "Create site"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default memo(SiteForm);
