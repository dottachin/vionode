import { memo, useMemo, useState } from "react";
import type { Order, OrderSet } from "@/types/order";

import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Folder, Package, Trash2, Pencil, CalendarDays, Layers, Weight,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Props = {
  sets: OrderSet[];
  onDelete?: (id: number | string) => Promise<void> | void;
  onRename?: (id: number | string, newName: string) => Promise<void> | void;
  onOpen?: (set: OrderSet) => void; // optional "view/open" handler
};

function OrderSetList({ sets, onDelete, onRename, onOpen }: Props) {
  const nf0 = useMemo(() => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }), []);
  const nf2 = useMemo(() => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }), []);

  if (!sets?.length) {
    return <p className="text-muted-foreground">No saved order sets.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {sets.map((s) => {
        const count = s.orders?.length ?? 0;

        // quick stats
        const totals = (s.orders ?? []).reduce(
          (acc, o: Order) => {
            acc.weight += typeof o.weight === "number" ? o.weight : 0;
            acc.surface += typeof o.surface === "number" ? o.surface : 0;
            return acc;
          },
          { weight: 0, surface: 0 }
        );

        const created = s.created_at ? new Date(s.created_at) : null;

        return (
          <Card key={s.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Folder className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <span className="truncate">{s.name}</span>
                </span>

                <div className="flex items-center gap-2">
                  {onRename && <RenameButton set={s} onRename={onRename} />}
                  {onDelete && <DeleteButton id={s.id} name={s.name ?? String(s.id)} onDelete={onDelete} />}
                </div>
              </CardTitle>

              <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {created && (
                  <>
                    <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-xs">{created.toLocaleString()}</span>
                    <span className="text-muted-foreground">•</span>
                  </>
                )}
                <span className="inline-flex items-center gap-1">
                  <Package className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {count} order{count > 1 ? "s" : ""}
                </span>
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="inline-flex items-center gap-1">
                  <Weight className="h-3.5 w-3.5" aria-hidden />
                  {nf0.format(totals.weight)} kg
                </Badge>
                <Badge variant="outline" className="inline-flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" aria-hidden />
                  {nf2.format(totals.surface)} ml
                </Badge>
              </div>

              {onOpen && (
                <div className="pt-2">
                  <Button size="sm" variant="outline" onClick={() => onOpen(s)}>
                    Open
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function DeleteButton({
  id,
  name,
  onDelete,
}: {
  id: number | string;
  name: string;
  onDelete: (id: number | string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    try {
      setBusy(true);
      await onDelete(id);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive" className="gap-2" disabled={busy}>
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. The order set and its orders will be deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={busy}>
            {busy ? "Suppression…" : "Confirmer"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RenameButton({
  set,
  onRename,
}: {
  set: OrderSet;
  onRename: (id: number | string, newName: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(set.name ?? "");
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      setBusy(true);
      await onRename(set.id, name.trim());
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-2" disabled={busy}>
          <Pencil className="h-4 w-4" />
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Rename order set</DialogTitle>
          <DialogDescription>ID : {set.id}</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Order set name"
            disabled={busy}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" onClick={handleSave} disabled={!name.trim() || busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default memo(OrderSetList);
