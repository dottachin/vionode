import { VEHICLE_TYPES, FUELS, type VehicleType } from "@/constants/domain";
﻿/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useMemo, useState } from "react";
import type { Vehicle, Driver } from "@/types/vehicle";
import type { Site } from "@/types/site";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Truck, Pencil, Trash2 } from "lucide-react";

// shadcn Select for Vehicle Type
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";


type Props = {
  vehicles: Vehicle[];
  drivers: Driver[];
  depots?: Site[];
  onUpdate?: (id: string, updates: Partial<Vehicle>) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
};

type VehicleFormState = Omit<Partial<Vehicle>, 'equipements'> & { equipements?: string | string[] };

const CARBURANTS = FUELS;

const VehicleList = ({ vehicles, drivers, depots, onUpdate, onDelete }: Props) => {
  const driverMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) m.set(String(d.id), d.name);
    return m;
  }, [drivers]);

  const depotMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of depots || []) m.set(String((d as any).id), d.name as string);
    return m;
  }, [depots]);

  const nf = useMemo(() => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }), []);

  if (!vehicles?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-muted-foreground" aria-hidden />
            Vehicles
          </CardTitle>
          <CardDescription>No vehicles available.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-muted-foreground" aria-hidden />
          Vehicles
        </CardTitle>
        <CardDescription>Compact list with editing.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle</TableHead>
                <TableHead>Depot</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Weight (kg)</TableHead>
                <TableHead className="text-right">Surface (ml)</TableHead>
                <TableHead className="text-right">Distance max (km)</TableHead>
                <TableHead className="text-right">Conso (L/km)</TableHead>
                <TableHead>Fuel</TableHead>
                <TableHead>Drivers</TableHead>
                <TableHead className="w-[1%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.map((v) => {
                const driverNames = (v.driver_ids || []).map((id) => driverMap.get(String(id)) ?? String(id));
                const idStr = String(v.id_vehicule);
                const depotLabel =
                  depotMap.get(String((v as any).depot_id)) ??
                  ((v as any).depot_id ? String((v as any).depot_id) : "-");
                return (
                  <TableRow key={idStr}>
                    <TableCell className="font-medium">{`${v.label}`}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {depotLabel}
                    </TableCell>
                    <TableCell className="text-muted-foreground capitalize">
                      {VEHICLE_TYPES.includes((v.type ?? "") as VehicleType) ? v.type : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {typeof v.weight === "number" ? nf.format(v.weight) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {typeof v.surface === "number" ? nf.format(v.surface) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {typeof v.max_distance === "number" ? nf.format(v.max_distance) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {typeof (v as any).conso === "number" ? nf.format((v as any).conso) : (v as any).conso ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {(v as any).carburant ?? "—"}
                    </TableCell>
                    <TableCell>
                      {driverNames.length ? (
                        <div className="flex flex-wrap gap-1">
                          {driverNames.map((name, i) => (
                            <Badge key={`${idStr}-d-${i}`} variant="secondary">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <EditVehicleDialog
                          vehicle={v}
                          drivers={drivers}
                          depots={depots}
                          onSave={async (updates) => {
                            await onUpdate?.(idStr, updates);
                          }}
                        >
                          <Button size="sm" variant="ghost" className="gap-2">
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                        </EditVehicleDialog>

                        {onDelete ? (
                          <ConfirmDelete
                            title="Delete vehicle"
                            description={`Are you sure you want to delete vehicle ${idStr}? This action cannot be undone.`}
                            onConfirm={async () => {
                              await onDelete(idStr);
                            }}
                          >
                            <Button size="sm" variant="ghost" className="gap-2 text-red-600 hover:text-red-700">
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </Button>
                          </ConfirmDelete>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

function ConfirmDelete({
  title,
  description,
  onConfirm,
  children,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<void> | void;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditVehicleDialog({
  vehicle,
  drivers,
  depots,
  onSave,
  children,
}: {
  vehicle: Vehicle;
  drivers: Driver[];
  depots?: Site[];
  onSave: (updates: Partial<Vehicle>) => Promise<void> | void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<VehicleFormState>(() => ({
    // NEW: editable label
    label: (vehicle as any).label ?? "",
    depot_id: (vehicle as any).depot_id ?? "",
    type: VEHICLE_TYPES.includes((vehicle.type ?? "") as VehicleType) ? (vehicle.type as VehicleType) : "",
    weight: Number(vehicle.weight),
    surface: vehicle.surface,
    max_distance: vehicle.max_distance,
    conso: (vehicle as any).conso,
    carburant: (vehicle as any).carburant,
    length: (vehicle as any).length,
    height: (vehicle as any).height,
    equipements: Array.isArray((vehicle as any).equipements)
  ? ((vehicle as any).equipements as any[]).join(", ")
  : "",
    fixed_cost: (vehicle as any).fixed_cost,
    driver_ids: (vehicle.driver_ids ?? []).map((x: any) =>
      Number.isInteger(Number(x)) ? Number(x) : x
    ) as any,
  }) as VehicleFormState);

  const nf = useMemo(() => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }), []);

  const setNum = (key: keyof Vehicle | "conso", raw: string) => {
    const val = raw.trim() === "" ? undefined : Number(raw.replace(",", "."));
    setForm((f) => ({ ...f, [key]: Number.isFinite(val) ? (val as any) : undefined }));
  };

  async function handleSave() {
    setSaving(true);
    try {
      const cleanedDrivers = Array.isArray(form.driver_ids)
        ? (form.driver_ids as Array<string | number>).map((x) =>
            Number.isInteger(Number(x)) ? Number(x) : x
          )
        : undefined;

      const normalizedType =
        typeof form.type === "string" ? form.type.trim() : "";

      const clean: Partial<Vehicle> = {
        // include label in updates
        label: (form.label ?? "").trim() || undefined,
        depot_id: typeof (form as any).depot_id === "string" ? (form as any).depot_id : undefined,
        type: (VEHICLE_TYPES as readonly string[]).includes(normalizedType)
          ? (normalizedType as VehicleType)
          : undefined,
        weight: typeof form.weight === "number" && form.weight >= 0 ? form.weight : undefined,
        surface: typeof form.surface === "number" && form.surface >= 0 ? form.surface : undefined,
        length:
          typeof (form as any).length === "number" && (form as any).length >= 0
            ? (form as any).length
            : undefined,
        height:
          typeof (form as any).height === "number" && (form as any).height >= 0
            ? (form as any).height
            : undefined,
        max_distance:
          typeof form.max_distance === "number" && form.max_distance >= 0
            ? Math.round(form.max_distance)
            : undefined,
        conso:
          typeof (form as any).conso === "number" && (form as any).conso >= 0
            ? (form as any).conso
            : (typeof (form as any).conso === "string" && (form as any).conso.trim() !== ""
                ? Number((form as any).conso.replace(",", "."))
                : undefined),
        carburant: typeof (form as any).carburant === "string" ? (form as any).carburant : undefined,
        equipements:
          typeof (form as any).equipements === "string"
            ? (form as any).equipements
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean)
            : Array.isArray((form as any).equipements)
            ? ((form as any).equipements as any[])
            : undefined,
        fixed_cost:
          typeof (form as any).fixed_cost === "number" && (form as any).fixed_cost >= 0
            ? (form as any).fixed_cost
            : undefined,
        driver_ids: cleanedDrivers as any,
      };

      await onSave(clean);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const availableDrivers = drivers.filter(
    (d) => !(form.driver_ids as any[] ?? []).map(String).includes(String(d.id))
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setForm({
            label: (vehicle as any).label ?? "",
            depot_id: (vehicle as any).depot_id ?? "",
            type: VEHICLE_TYPES.includes((vehicle.type ?? "") as VehicleType) ? (vehicle.type as VehicleType) : "",
            weight: vehicle.weight,
            surface: vehicle.surface,
            max_distance: vehicle.max_distance,
            conso: (vehicle as any).conso as number,
            carburant: (vehicle as any).carburant as string | undefined,
            length: (vehicle as any).length,
            height: (vehicle as any).height,
            equipements: Array.isArray((vehicle as any).equipements)
              ? ((vehicle as any).equipements as any[]).join(", ")
              : "",
            fixed_cost: (vehicle as any).fixed_cost as number | undefined,
            driver_ids: (vehicle.driver_ids ?? []).map((x: any) =>
              Number.isInteger(Number(x)) ? Number(x) : x
            ) as any,
          });
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
          <DialogTitle>Edit vehicle</DialogTitle>
          <DialogDescription>ID : {`${String((vehicle as any).id_vehicule ?? "")}`}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Label */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="label" className="text-right">Vehicle</Label>
            <Input
              id="label"
              className="col-span-3"
              value={(form as any).label ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Vehicle name or reference"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="depot" className="text-right">Depot</Label>
            <div className="col-span-3">
              <Select
                value={(form as any).depot_id ?? ""}
                onValueChange={(val) => setForm((f) => ({ ...f, depot_id: val }))}
              >
                  <SelectTrigger id="depot">
                  <SelectValue placeholder="Choose a depot..." />
                </SelectTrigger>
                <SelectContent>
                  {(depots || []).map((d) => (
                    <SelectItem key={String((d as any).id)} value={String((d as any).id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>


          {/* Type (Select) */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="type" className="text-right">Type</Label>
            <div className="col-span-3">
              <Select
                value={(form.type as VehicleType) ?? ""}
                onValueChange={(val) => setForm((f) => ({ ...f, type: val as VehicleType }))}
              >
                  <SelectTrigger id="type">
                  <SelectValue placeholder="Choose a type…" />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="weight" className="text-right">Weight (kg)</Label>
            <Input
              id="weight"
              inputMode="decimal"
              className="col-span-3"
              value={form.weight ?? ""}
              onChange={(e) => setNum("weight", e.target.value)}
              placeholder="ex: 28000"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="surface" className="text-right">Surface (linear m)</Label>
            <Input
              id="surface"
              inputMode="decimal"
              className="col-span-3"
              value={form.surface ?? ""}
              onChange={(e) => setNum("surface", e.target.value)}
              placeholder="ex: 35"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="distance" className="text-right">Distance max (km)</Label>
            <Input
              id="distance"
              inputMode="decimal"
              className="col-span-3"
              value={
                typeof form.max_distance === "number" ? nf.format(form.max_distance).replace(/\s/g, "") : ""
              }
              onChange={(e) => {
                const raw = e.target.value.trim();
                const num = raw === "" ? undefined : Number(raw.replace(",", "."));
                setForm((f) => ({
                  ...f,
                  max_distance: Number.isFinite(num) && (num as number) >= 0 ? Math.round(num as number) : undefined,
                }));
              }}
              placeholder="ex: 800"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="conso" className="text-right">Conso (L/km)</Label>
            <Input
              id="conso"
              inputMode="decimal"
              className="col-span-3"
              value={(form as any).conso ?? ""}
              onChange={(e) => setNum("conso", e.target.value)}
              placeholder="ex: 0.3"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="carburant" className="text-right">Fuel</Label>
            <select
              id="carburant"
              className="col-span-3 h-9 rounded-md border bg-background px-3 text-sm"
              value={(form as any).carburant ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, carburant: e.target.value as any }))}
            >
              <option value="" disabled>Choose…</option>
              {CARBURANTS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="text-right pt-2">Drivers</Label>
            <div className="col-span-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                {(form.driver_ids as any[] ?? []).length ? (
                  (form.driver_ids as any[]).map((id) => {
                    const name = drivers.find((d) => String(d.id) === String(id))?.name ?? String(id);
                    return (
                      <Badge key={String(id)} variant="secondary" className="gap-2">
                        {name}
                        <button
                          type="button"
                          aria-label={`Retirer ${name}`}
                          className="ml-1 rounded px-1 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              driver_ids: (f.driver_ids as any[]).filter((x) => String(x) !== String(id)),
                            }))
                          }
                        >
                          ×
                        </button>
                      </Badge>
                    );
                  })
                ) : (
                  <span className="text-sm text-muted-foreground">No driver selected.</span>
                )}
              </div>

              <div className="flex gap-2">
                <select
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (!raw) return;
                    const id = Number.isInteger(Number(raw)) ? Number(raw) : raw;
                    setForm((f) => ({
                      ...f,
                      driver_ids: [ ...((f.driver_ids as any[]) ?? []), id ],
                    }));
                    e.currentTarget.selectedIndex = 0;
                  }}
                >
                  <option value="">Add a driver…</option>
                  {availableDrivers.map((d) => (
                    <option key={String(d.id)} value={String(d.id)}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default memo(VehicleList);
