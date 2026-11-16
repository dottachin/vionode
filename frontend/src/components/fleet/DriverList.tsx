/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useMemo, useState } from "react";
import type { Vehicle, Driver } from "@/types/vehicle";
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
import { Pencil, Trash2, UserSquare2 } from "lucide-react";

type Props = {
  drivers: Driver[];
  vehicles: Vehicle[];
  onUpdate?: (id: string, updates: Partial<Driver>) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void; // ⬅️ NEW
};

const DriverList = ({ drivers, vehicles, onUpdate, onDelete }: Props) => {
  const vehicleMapByDriver = useMemo(() => {
    const m = new Map<string, Array<Pick<Vehicle, "id_vehicule" | "type">>>();
    for (const v of vehicles ?? []) {
      for (const dId of (v.driver_ids as any[] ?? [])) {
        const key = String(dId);
        if (!m.has(key)) m.set(key, []);
        m.get(key)!.push({ id_vehicule: v.id_vehicule, type: v.type });
      }
    }
    return m;
  }, [vehicles]);

  const nf = useMemo(() => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }), []);

  if (!drivers?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserSquare2 className="h-5 w-5 text-muted-foreground" aria-hidden />
            Chauffeurs
          </CardTitle>
          <CardDescription>Aucun chauffeur disponible.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserSquare2 className="h-5 w-5 text-muted-foreground" aria-hidden />
          Chauffeurs
        </CardTitle>
        <CardDescription>Liste compacte avec véhicules affectés.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead className="text-right">Conduite/jour (h)</TableHead>
                <TableHead className="text-right">Service/jour (h)</TableHead>
                <TableHead>Véhicules affectés</TableHead>
                {(onUpdate || onDelete) ? <TableHead className="w-[1%] text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers.map((d) => {
                const key = String(d.id);
                const assigned = vehicleMapByDriver.get(key) ?? [];
                return (
                  <TableRow key={key}>
                    <TableCell className="text-foreground">{d.name}</TableCell>
                    <TableCell className="text-right">
                      {typeof d.max_daily_driving_hours === "number" ? nf.format(d.max_daily_driving_hours) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {typeof d.max_daily_service_hours === "number" ? nf.format(d.max_daily_service_hours) : "—"}
                    </TableCell>
                    <TableCell>
                      {assigned.length ? (
                        <div className="flex flex-wrap gap-1">
                          {assigned.map((v) => (
                            <Badge key={`drv-${key}-veh-${String(v.id_vehicule)}`} variant="secondary">
                              {`VEH-${String(v.id_vehicule)}`}{v.type ? ` · ${v.type}` : ""}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {(onUpdate || onDelete) ? (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {onUpdate ? (
                            <EditDriverDialog
                              driver={d}
                              onSave={async (updates) => {
                                await onUpdate?.(key, updates);
                              }}
                            >
                              <Button size="sm" variant="ghost" className="gap-2">
                                <Pencil className="h-4 w-4" />
                                Modifier
                              </Button>
                            </EditDriverDialog>
                          ) : null}

                          {onDelete ? (
                            <ConfirmDelete
                              title="Supprimer le chauffeur"
                              description={`Voulez-vous vraiment supprimer le chauffeur ${d.name} (${key}) ? Cette action est irréversible.`}
                              onConfirm={async () => {
                                await onDelete(key);
                              }}
                            >
                              <Button size="sm" variant="ghost" className="gap-2 text-red-600 hover:text-red-700">
                                <Trash2 className="h-4 w-4" />
                                Supprimer
                              </Button>
                            </ConfirmDelete>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
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
          <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
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
            {busy ? "Suppression…" : "Supprimer"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditDriverDialog({
  driver,
  onSave,
  children,
}: {
  driver: Driver;
  onSave: (updates: Partial<Driver>) => Promise<void> | void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Driver>>(() => ({
    name: driver.name ?? "",
    max_daily_driving_hours: driver.max_daily_driving_hours,
    max_daily_service_hours: driver.max_daily_service_hours,
  }));

  const setNum = (
    key: keyof Pick<Driver, "max_daily_driving_hours" | "max_daily_service_hours">,
    raw: string
  ) => {
    const trimmed = raw.trim();
    const val = trimmed === "" ? undefined : Number(trimmed.replace(",", "."));
    setForm((f) => ({
      ...f,
      [key]: Number.isFinite(val as number) && (val as number) >= 0 ? (val as number) : undefined,
    }));
  };

  async function handleSave() {
    setSaving(true);
    try {
      const clean: Partial<Driver> = {
        name: typeof form.name === "string" ? form.name.trim() || undefined : undefined,
        max_daily_driving_hours:
          typeof form.max_daily_driving_hours === "number" && form.max_daily_driving_hours >= 0
            ? form.max_daily_driving_hours
            : undefined,
        max_daily_service_hours:
          typeof form.max_daily_service_hours === "number" && form.max_daily_service_hours >= 0
            ? form.max_daily_service_hours
            : undefined,
      };
      await onSave(clean);
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
            name: driver.name ?? "",
            max_daily_driving_hours: driver.max_daily_driving_hours,
            max_daily_service_hours: driver.max_daily_service_hours,
          });
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Modifier le chauffeur</DialogTitle>
          <DialogDescription>Nom : {`${String(driver.name)}`}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="d-name" className="text-right">Nom</Label>
            <Input
              id="d-name"
              className="col-span-3"
              value={form.name ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="ex: Ahmed El F."
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="d-driving" className="text-right">Conduite/jour (h)</Label>
            <Input
              id="d-driving"
              inputMode="decimal"
              className="col-span-3"
              value={form.max_daily_driving_hours ?? ""}
              onChange={(e) => setNum("max_daily_driving_hours", e.target.value)}
              placeholder="ex: 9"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="d-service" className="text-right">Service/jour (h)</Label>
            <Input
              id="d-service"
              inputMode="decimal"
              className="col-span-3"
              value={form.max_daily_service_hours ?? ""}
              onChange={(e) => setNum("max_daily_service_hours", e.target.value)}
              placeholder="ex: 12"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">Annuler</Button>
          </DialogClose>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default memo(DriverList);
