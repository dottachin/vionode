import { VEHICLE_TYPES, FUELS, DEFAULT_FUEL } from "@/constants/domain";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useId, useMemo, useState } from "react";
import { createVehicle, fetchDrivers as fetchDriversApi } from "@/api/vehicles";
import { fetchSites } from "@/api/site";
import type { Vehicle, Driver } from "@/types/vehicle";
import type { Site } from "@/types/site";
import { normalizeCategory } from "@/utils/sanitizeOptimizerInput";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, ChevronsUpDown, Check, X as XIcon, Users } from "lucide-react";


type Props = {
  onCreated?: (v: Vehicle) => void;
  drivers?: Driver[];
  depots?: Site[];
};

type FormState = {
  label: string;
  depot_id: string;
  type: string;
  weight: string;
  surface: string;
  length: string;
  height: string;
  emission_rate: string;
  max_distance_km: string;
  fuel_consumption: string;
  fuel_type: string;
  driver_ids: string[];
  equipment: string;
  fixed_cost: string;
};

type FormErrors = Partial<Record<keyof FormState | "_form", string>>;

const DEFAULTS: FormState = {
  label: "",
  depot_id: "",
  type: "",
  weight: "24000",
  surface: "13.8",
  length: "1",
  height: "1",
  emission_rate: "0",
  max_distance_km: "800",
  fuel_consumption: "0.3",
  fuel_type: DEFAULT_FUEL,
  equipment: "",
  fixed_cost: "0",
  driver_ids: [],
};

export default function VehicleForm({ onCreated, drivers: driversProp, depots: depotsProp }: Props) {
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const [localDrivers, setLocalDrivers] = useState<Driver[] | null>(null);
  const drivers: Driver[] = useMemo(() => driversProp ?? localDrivers ?? [], [driversProp, localDrivers]);

  const [localDepots, setLocalDepots] = useState<Site[] | null>(null);
  const depots: Site[] = useMemo(() => depotsProp ?? localDepots ?? [], [depotsProp, localDepots]);

  useEffect(() => {
    if (!driversProp) {
      fetchDriversApi()
        .then(setLocalDrivers)
        .catch(() => setLocalDrivers([]));
    }
  }, [driversProp]);

  useEffect(() => {
    if (!depotsProp) {
      fetchSites()
        .then((sites) =>
          setLocalDepots((sites || []).filter((s: Site) => normalizeCategory(s.category) === "depot"))
        )
        .catch(() => setLocalDepots([]));
    }
  }, [depotsProp]);

  useEffect(() => {
    if (!form.depot_id && depots.length > 0) {
      setForm((prev) => ({ ...prev, depot_id: depots[0].id }));
    }
  }, [depots, form.depot_id]);

  const labelId = useId();
  const depotId = useId();
  const typeId = useId();
  const weightId = useId();
  const surfaceId = useId();
  const lengthId = useId();
  const heightId = useId();
  const emissionId = useId();
  const distanceId = useId();
  const fuelConsumptionId = useId();
  const fuelTypeId = useId();
  const equipmentId = useId();
  const fixedCostId = useId();
  const driverId = useId();

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(DEFAULTS), [form]);

  const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined, _form: undefined }));
  };

  const parseNumber = (raw: string) => {
    const normalized = raw.replace(",", ".").trim();
    if (normalized === "") return NaN;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : NaN;
  };

  const validate = (data: FormState): FormErrors => {
    const next: FormErrors = {};

    if (!data.depot_id.trim()) next.depot_id = "Depot is required.";
    if (!data.type.trim()) next.type = "Type is required.";

    const weight = parseNumber(data.weight);
    if (Number.isNaN(weight)) next.weight = "Enter a valid weight.";
    else if (weight <= 0) next.weight = "Weight must be greater than 0.";

    const surface = parseNumber(data.surface);
    if (Number.isNaN(surface)) next.surface = "Enter a valid surface.";
    else if (surface <= 0) next.surface = "Surface must be greater than 0.";

    const length = parseNumber(data.length);
    if (Number.isNaN(length)) next.length = "Enter a valid length.";
    else if (length <= 0) next.length = "Length must be greater than 0.";

    const height = parseNumber(data.height);
    if (Number.isNaN(height)) next.height = "Enter a valid height.";
    else if (height <= 0) next.height = "Height must be greater than 0.";

    const emission = parseNumber(data.emission_rate);
    if (Number.isNaN(emission)) next.emission_rate = "Enter a valid emission rate.";
    else if (emission < 0) next.emission_rate = "Emission rate cannot be negative.";

    const maxKm = parseNumber(data.max_distance_km);
    if (Number.isNaN(maxKm)) next.max_distance_km = "Enter a valid max distance.";
    else if (maxKm <= 0) next.max_distance_km = "Max distance must be greater than 0.";

    const fuel_consumption = parseNumber(data.fuel_consumption);
    if (Number.isNaN(fuel_consumption)) next.fuel_consumption = "Enter a valid consumption.";
    else if (fuel_consumption < 0) next.fuel_consumption = "Consumption cannot be negative.";

    if (!data.fuel_type.trim()) next.fuel_type = "Choose a fuel.";

    const fixedRaw = data.fixed_cost.trim();
    if (fixedRaw !== "") {
      const fixedCost = parseNumber(data.fixed_cost);
      if (Number.isNaN(fixedCost) || fixedCost < 0) next.fixed_cost = "Fixed cost must be positive.";
    }

    if (!data.driver_ids.length) next.driver_ids = "Select at least one driver.";

    return next;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErrors({});

    const v = validate(form);
    if (Object.values(v).some(Boolean)) {
      setErrors(v);
      return;
    }

    const payload = {
      label: form.label.trim() || undefined,
      depot_id: form.depot_id,
      type: form.type.trim(),
      weight: parseNumber(form.weight),
      surface: parseNumber(form.surface),
      length: parseNumber(form.length),
      height: parseNumber(form.height),
      emission_rate: parseNumber(form.emission_rate),
      max_distance: Math.round(parseNumber(form.max_distance_km)),
      fuel_consumption: parseNumber(form.fuel_consumption),
      fuel_type: form.fuel_type,
      equipment: form.equipment
        ? form.equipment.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      fixed_cost:
        form.fixed_cost.trim() === ""
          ? undefined
          : parseNumber(form.fixed_cost),
      driver_ids: form.driver_ids.map(String),
    };

    try {
      setSubmitting(true);
      const created = await createVehicle(payload as any);
      onCreated?.(created as unknown as Vehicle);
      setForm(DEFAULTS);
      setErrors({});
    } catch {
      setErrors((prev) => ({
        ...prev,
        _form: "Creation failed. Check the fields and try again.",
      }));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && isDirty && !Object.values(validate(form)).some(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          Add a vehicle
        </CardTitle>
      </CardHeader>

      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div>
            <Label className="mb-2 block" htmlFor={labelId}>
              Vehicle
            </Label>
            <Input
              id={labelId}
              value={form.label}
              placeholder="e.g. Reefer #12, Regional truck"
              onChange={(e) => handleChange("label", e.target.value)}
            />
          </div>

          <div>
            <Label className="mb-2 block" htmlFor={depotId}>
              Depot <span className="text-red-500">*</span>
            </Label>
            <Select
              value={form.depot_id}
              onValueChange={(val) => handleChange("depot_id", val)}
              disabled={depots.length === 0}
            >
              <SelectTrigger id={depotId} aria-invalid={Boolean(errors.depot_id)}>
                <SelectValue placeholder={depots.length ? "Choose a depot" : "No depot available"} />
              </SelectTrigger>
              <SelectContent>
                {depots.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.depot_id && <p className="mt-1 text-sm text-red-600">{errors.depot_id}</p>}
            {depots.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">Add a site with category "depot" to link the vehicle.</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block" htmlFor={typeId}>
              Type <span className="text-red-500">*</span>
            </Label>
            <Select value={form.type} onValueChange={(val) => handleChange("type", val)}>
              <SelectTrigger id={typeId} aria-invalid={Boolean(errors.type)}>
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.type && <p className="mt-1 text-sm text-red-600">{errors.type}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-2 block" htmlFor={weightId}>
                Weight (kg) <span className="text-red-500">*</span>
              </Label>
              <Input
                id={weightId}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.weight}
                placeholder="24000"
                aria-invalid={Boolean(errors.weight)}
                onChange={(e) => handleChange("weight", e.target.value)}
              />
              {errors.weight && <p className="mt-1 text-sm text-red-600">{errors.weight}</p>}
            </div>

            <div>
              <Label className="mb-2 block" htmlFor={surfaceId}>
                Surface (m2 plancher) <span className="text-red-500">*</span>
              </Label>
              <Input
                id={surfaceId}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.surface}
                placeholder="13.8"
                aria-invalid={Boolean(errors.surface)}
                onChange={(e) => handleChange("surface", e.target.value)}
              />
              {errors.surface && <p className="mt-1 text-sm text-red-600">{errors.surface}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-2 block" htmlFor={lengthId}>
                Longueur (m) <span className="text-red-500">*</span>
              </Label>
              <Input
                id={lengthId}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.length}
                placeholder="1"
                aria-invalid={Boolean(errors.length)}
                onChange={(e) => handleChange("length", e.target.value)}
              />
              {errors.length && <p className="mt-1 text-sm text-red-600">{errors.length}</p>}
            </div>

            <div>
              <Label className="mb-2 block" htmlFor={heightId}>
                Hauteur (m) <span className="text-red-500">*</span>
              </Label>
              <Input
                id={heightId}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.height}
                placeholder="1"
                aria-invalid={Boolean(errors.height)}
                onChange={(e) => handleChange("height", e.target.value)}
              />
              {errors.height && <p className="mt-1 text-sm text-red-600">{errors.height}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-2 block" htmlFor={emissionId}>
                Emission (g/km) <span className="text-red-500">*</span>
              </Label>
              <Input
                id={emissionId}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.emission_rate}
                aria-invalid={Boolean(errors.emission_rate)}
                onChange={(e) => handleChange("emission_rate", e.target.value)}
              />
              {errors.emission_rate && <p className="mt-1 text-sm text-red-600">{errors.emission_rate}</p>}
            </div>

            <div>
              <Label className="mb-2 block" htmlFor={distanceId}>
                Distance max (km) <span className="text-red-500">*</span>
              </Label>
              <Input
                id={distanceId}
                type="number"
                inputMode="decimal"
                step="1"
                min="0"
                value={form.max_distance_km}
                aria-invalid={Boolean(errors.max_distance_km)}
                onChange={(e) => handleChange("max_distance_km", e.target.value)}
              />
              {errors.max_distance_km && <p className="mt-1 text-sm text-red-600">{errors.max_distance_km}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-2 block" htmlFor={fuelConsumptionId}>
                Consommation (L/km) <span className="text-red-500">*</span>
              </Label>
              <Input
                id={fuelConsumptionId}
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                value={form.fuel_consumption}
                aria-invalid={Boolean(errors.fuel_consumption)}
                onChange={(e) => handleChange("fuel_consumption", e.target.value)}
              />
              {errors.fuel_consumption && <p className="mt-1 text-sm text-red-600">{errors.fuel_consumption}</p>}
            </div>

            <div>
              <Label className="mb-2 block" htmlFor={fuelTypeId}>
                Fuel <span className="text-red-500">*</span>
              </Label>
              <Select value={form.fuel_type} onValueChange={(val) => handleChange("fuel_type", val)}>
                <SelectTrigger id={fuelTypeId} aria-invalid={Boolean(errors.fuel_type)} className="w-full min-w-0">
                  <SelectValue placeholder="Choose a fuel" className="truncate flex-1 min-w-0" />
                </SelectTrigger>
                <SelectContent>
                  {FUELS.map((c) => (
                    <SelectItem key={c} value={c} title={c} className="min-w-0">
                      <span className="block truncate">{c}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {errors.fuel_type && <p className="mt-1 text-sm text-red-600">{errors.fuel_type}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-2 block" htmlFor={equipmentId}>
                Equipment (comma-separated)
              </Label>
              <Input
                id={equipmentId}
                value={form.equipment}
                placeholder="frigo, hayon..."
                onChange={(e) => handleChange("equipment", e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-2 block" htmlFor={fixedCostId}>
                Fixed cost (per route)
              </Label>
              <Input
                id={fixedCostId}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.fixed_cost}
                aria-invalid={Boolean(errors.fixed_cost)}
                onChange={(e) => handleChange("fixed_cost", e.target.value)}
              />
              {errors.fixed_cost && <p className="mt-1 text-sm text-red-600">{errors.fixed_cost}</p>}
            </div>
          </div>

          <div>
            <Label className="mb-2 block" htmlFor={driverId}>
              Drivers <span className="text-red-500">*</span>
            </Label>

            <DriverMultiSelect
              allDrivers={drivers}
              value={form.driver_ids}
              onChange={(ids) => handleChange("driver_ids", ids.map(String))}
              inputId={driverId}
              error={errors.driver_ids}
            />

            {errors.driver_ids && <p className="mt-1 text-sm text-red-600">{errors.driver_ids}</p>}
          </div>

          {errors._form && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errors._form}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={!canSubmit} aria-busy={submitting}>
            {submitting ? "Creating..." : "Create"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DriverMultiSelect({
  allDrivers,
  value,
  onChange,
  inputId,
  error,
}: {
  allDrivers: Driver[];
  value: string[];
  onChange: (ids: string[]) => void;
  inputId: string;
  error?: string;
}) {
  const [open, setOpen] = useState(false);

  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of allDrivers || []) m.set(String(d.id), d.name);
    return m;
  }, [allDrivers]);

  const selectedNames = value.map((id) => map.get(id) ?? id);

  const toggle = (idStr: string) => {
    if (value.includes(idStr)) onChange(value.filter((x) => x !== idStr));
    else onChange([...value, idStr]);
  };

  return (
    <div aria-describedby={error ? `${inputId}-error` : undefined}>
      <div className="flex flex-wrap gap-2">
        {selectedNames.map((name, idx) => (
          <Badge key={`${name}-${idx}`} variant="secondary" className="gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {name}
            <button
              type="button"
              className="ml-1 inline-flex rounded-sm p-0.5 hover:bg-muted"
              onClick={() => toggle(value[idx])}
              aria-label={`Retirer ${name}`}
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </Badge>
        ))}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={inputId}
            type="button"
            variant="outline"
            className="mt-2 inline-flex w-full items-center justify-between"
            aria-invalid={Boolean(error)}
          >
            <span className="truncate">
              {value.length ? "Edit selection" : "Select drivers"}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search drivers..." />
            <CommandEmpty>No results.</CommandEmpty>
            <ScrollArea className="max-h-64">
              <CommandGroup>
                {allDrivers?.map((d) => {
                  const idStr = String(d.id);
                  const checked = value.includes(idStr);
                  return (
                    <CommandItem key={idStr} onSelect={() => toggle(idStr)} className="gap-2">
                      <Checkbox checked={checked} onCheckedChange={() => toggle(idStr)} />
                      <span className="truncate">{d.name}</span>
                      {checked && <Check className="ml-auto h-4 w-4 opacity-60" aria-hidden="true" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </ScrollArea>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
