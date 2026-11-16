// src/components/orders/OrderForm.tsx
import { memo, useMemo, useState } from "react";
import type { Order } from "@/types/order";
import type { Site } from "@/types/site";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import MultiSelect from "@/components/ui/MultiSelect";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

import { PackagePlus, ThermometerSnowflake, Zap, MapPin, X } from "lucide-react";

/* -------------------------- Package → surface rules -------------------------- */
const SURFACE_SCALE_FACTOR = 100;
const WEIGHT_SCALE_FACTOR = 100;
const PALLET_SURFACE = 0.40;      // ml
const HALF_PALLET_SURFACE = 0.20; // ml
const PARCEL_SURFACE = 0.10;      // ml

type PackageCounts = {
  palettes: number;
  palettes_hf: number;   // non-standard pallets
  semi_palettes: number; // “Semi-palettes”
  colis: number;         // parcels
  rlx: number;           // “RLX” (treated like colis)
};

const computeSurfaceFromPackages = (p: PackageCounts): number =>
  p.palettes * PALLET_SURFACE +
  p.palettes_hf * PALLET_SURFACE +
  p.semi_palettes * HALF_PALLET_SURFACE +
  p.colis * PARCEL_SURFACE +
  p.rlx * PARCEL_SURFACE;

/* ----------------------------- Hazardous enum UI ----------------------------- */
const HAZARD_OPTIONS = [
  { value: "Poison", label: "Poison" },
  { value: "Explosives", label: "Explosives" },
  { value: "Gas", label: "Gas" },
  { value: "Flammable", label: "Flammable" },
  { value: "Organic", label: "Organic" },
  { value: "Radioactive", label: "Radioactive" },
  { value: "Corrosive", label: "Corrosive" },
  { value: "Other", label: "Other" },
  { value: "Flammable solid combustible", label: "Flammable solid combustible" },
  { value: "Goods harmful for water", label: "Goods harmful for water" },
  { value: "Poisonous inhalation hazard", label: "Poisonous inhalation hazard" },
  { value: "Explosive and flammable", label: "Explosive and flammable" },
  { value: "Hazardous material type unknown", label: "Hazardous material type unknown" },
  { value: "Unspecified hazardous material type", label: "Unspecified hazardous material type" },
  { value: "Any hazardous material", label: "Any hazardous material" },
] as const;

type Props = {
  onAdd: (order: Order) => void;
  onAddAndStay?: (order: Order) => void;
  allSites: Site[];
};

function OrderForm({ onAdd, onAddAndStay, allSites }: Props) {
  const [form, setForm] = useState<{
    pickup_site_id: string;
    delivery_site_id: string;
    weight: number | undefined;
    requires_refrigeration: boolean;
    notes: string;
  }>({
    pickup_site_id: "",
    delivery_site_id: "",
    weight: 0,
    requires_refrigeration: false,
    notes: "",
  });

  // package counts (drives auto surface)
  const [packages, setPackages] = useState<PackageCounts>({
    palettes: 0,
    palettes_hf: 0,
    semi_palettes: 0,
    colis: 0,
    rlx: 0,
  });

  // multiselect for hazardous types
  const [hazardousTypes, setHazardousTypes] = useState<string[]>([]);

  const computedSurface = useMemo(() => computeSurfaceFromPackages(packages), [packages]);

  const siteMap = useMemo(() => {
    const m = new Map<string, Site>();
    for (const s of allSites || []) m.set(s.id, s);
    return m;
  }, [allSites]);

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setWeight = (raw: string) => {
    const v = raw.trim() === "" ? undefined : Number(raw);
    setForm((prev) => ({
      ...prev,
      weight:
        typeof v === "number" && Number.isFinite(v) && v >= 0
          ? (v as number)
          : ((prev.weight as number | undefined) ?? 0),
    }));
  };

  const setPkg = (key: keyof PackageCounts, raw: string) => {
    const n = Math.max(0, Math.floor(Number(raw)));
    setPackages((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : prev[key] }));
  };

  const buildOrder = (): Order | null => {
    if (!form.pickup_site_id?.trim() || !form.delivery_site_id?.trim()) {
      alert("Pickup and delivery are required.");
      return null;
    }
    const surface = computedSurface*SURFACE_SCALE_FACTOR;

    const order = {
      id: "",
      pickup_site_id: form.pickup_site_id.trim(),
      delivery_site_id: form.delivery_site_id.trim(),
      weight: typeof form.weight === "number" ? form.weight*WEIGHT_SCALE_FACTOR : 0,
      surface, // auto-computed from package counts
      requires_refrigeration: !!form.requires_refrigeration,
      hazardous_types: hazardousTypes.slice(),
      notes: form.notes ?? "",
    } as unknown as Order;

    return order;
  };

  const resetForm = () => {
    setForm({
      pickup_site_id: "",
      delivery_site_id: "",
      weight: 0,
      requires_refrigeration: false,
      notes: "",
    });
    setPackages({
      palettes: 0,
      palettes_hf: 0,
      semi_palettes: 0,
      colis: 0,
      rlx: 0,
    });
    setHazardousTypes([]);
  };

  const handleAddAndClose = () => {
    const order = buildOrder();
    if (!order) return;
    onAdd(order);
    resetForm();
  };

  const handleAddAndStay = () => {
    const order = buildOrder();
    if (!order) return;
    if (onAddAndStay) onAddAndStay(order);
    else onAdd(order);
    resetForm();
  };

  const pickupSite = form.pickup_site_id ? siteMap.get(form.pickup_site_id) : undefined;
  const deliverySite = form.delivery_site_id ? siteMap.get(form.delivery_site_id) : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackagePlus className="h-5 w-5 text-muted-foreground" aria-hidden />
          Add an order
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Site selectors */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="block">Pickup (site)</Label>
            <SiteSelect
              sites={allSites}
              selectedId={form.pickup_site_id ?? ""}
              onSelect={(id) => setField("pickup_site_id", id)}
              placeholder="Choose a pickup site…"
            />
            {pickupSite && (
              <SiteMiniPreview site={pickupSite} onClear={() => setField("pickup_site_id", "")} />
            )}
          </div>

          <div className="space-y-2">
            <Label className="block">Delivery (site)</Label>
            <SiteSelect
              sites={allSites}
              selectedId={form.delivery_site_id ?? ""}
              onSelect={(id) => setField("delivery_site_id", id)}
              placeholder="Choose a delivery site…"
            />
            {deliverySite && (
              <SiteMiniPreview site={deliverySite} onClear={() => setField("delivery_site_id", "")} />
            )}
          </div>
        </div>

        {/* Poids on its own line, then surface/conditionnement immediately after */}
        <div className="space-y-3">
          <div>
            <Label htmlFor="weight" className="mb-2 block">Weight (kg)</Label>
            <Input
              id="weight"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={form.weight ?? ""}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="ex: 1000"
            />
          </div>

          <div className="space-y-2">
            <Label className="block">Packaging</Label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="palettes" className="text-xs">Pallets</Label>
                <Input
                  id="palettes"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={packages.palettes}
                  onChange={(e) => setPkg("palettes", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="palettes_hf" className="text-xs">Pallets (non-standard)</Label>
                <Input
                  id="palettes_hf"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={packages.palettes_hf}
                  onChange={(e) => setPkg("palettes_hf", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="semi_palettes" className="text-xs">Semi-palettes</Label>
                <Input
                  id="semi_palettes"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={packages.semi_palettes}
                  onChange={(e) => setPkg("semi_palettes", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="colis" className="text-xs">Parcels</Label>
                <Input
                  id="colis"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={packages.colis}
                  onChange={(e) => setPkg("colis", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rlx" className="text-xs">RLX</Label>
                <Input
                  id="rlx"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={packages.rlx}
                  onChange={(e) => setPkg("rlx", e.target.value)}
                />
              </div>
            </div>

            <div className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
              Estimated surface: <b>{computedSurface.toFixed(2)} ml</b>
            </div>
          </div>
        </div>

        {/* Refrigeration + Hazardous multiselect */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="refrig"
              checked={!!form.requires_refrigeration}
              onCheckedChange={(v) => setField("requires_refrigeration", v === true)}
            />
            <Label htmlFor="refrig" className="flex items-center gap-2">
              <ThermometerSnowflake className="h-4 w-4 text-muted-foreground" aria-hidden />
              Refrigeration required
            </Label>
          </div>

          <div>
            <Label className="mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
              Hazardous materials
            </Label>
            <MultiSelect
              value={hazardousTypes}
              onChange={setHazardousTypes}
              options={HAZARD_OPTIONS.map(({ value, label }) => ({ value, label }))}
              placeholder="No selection"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="notes" className="mb-2 block">Notes</Label>
          <Textarea
            id="notes"
            value={form.notes ?? ""}
            onChange={(e) => setField("notes", e.target.value)}
            placeholder="Additional notes…"
          />
        </div>

        {/* Action buttons */}
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Button onClick={handleAddAndClose} className="w-full">
            Add & close
          </Button>
          <Button onClick={handleAddAndStay} variant="outline" className="w-full">
            Add & continue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Small reusable site selector (searchable) ---------- */

function SiteSelect({
  sites,
  selectedId,
  onSelect,
  placeholder,
}: {
  sites: Site[];
  selectedId: string;
  onSelect: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => sites.find((s) => s.id === selectedId), [sites, selectedId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          type="button"
          role="combobox"
          aria-expanded={open}
        >
          <span className="truncate">
            {selected ? `${selected.name}${renderCitySuffix(selected)}` : (placeholder ?? "Choose a site…")}
          </span>
          <kbd className="ml-2 rounded border bg-muted px-1 text-[10px]">⌄</kbd>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by name, city, address…" />
          <CommandList>
            <CommandEmpty>No results</CommandEmpty>
            <CommandGroup heading="Sites">
              {sites.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.name} ${getCity(s)} ${s.address ?? ""}`}
                  onSelect={() => {
                    onSelect(s.id);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
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
  );
}

function SiteMiniPreview({ site, onClear }: { site: Site; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs">
      <div className="min-w-0">
        <div className="truncate font-medium">{site.name}</div>
        <div className="truncate text-muted-foreground">
          {getCity(site)} {site.address ? `· ${site.address}` : ""} · <span className="font-mono">{site.id}</span>
        </div>
      </div>
      <button
        type="button"
        className="ml-3 inline-flex rounded p-1 hover:bg-muted"
        aria-label="Clear selection"
        onClick={onClear}
      >
        <X className="h-4 w-4" />
      </button>
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
function renderCitySuffix(s: Site) {
  const c = getCity(s);
  return c ? ` · ${c}` : "";
}

export default memo(OrderForm);
