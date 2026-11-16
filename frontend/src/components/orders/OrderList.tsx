import { memo, useMemo, useState } from "react";
import type { Order } from "@/types/order";
import type { Site } from "@/types/site";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Package,
  Trash2,
  ThermometerSnowflake,
  Zap,
  Factory,
  MapPin,
  StickyNote,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Props = {
  orders: Order[];
  sites: Site[];               // ✅ needed to resolve names
  onDelete?: (id: string) => void;
};
const SURFACE_SCALE_FACTOR = 100;
function OrderList({ orders, sites, onDelete }: Props) {
  const nf0 = useMemo(() => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }), []);
  const nf2 = useMemo(() => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }), []);

  const siteMap = useMemo(() => {
    const m = new Map<string, Site>();
    for (const s of sites || []) m.set(s.id, s);
    return m;
  }, [sites]);

  if (!orders.length) {
    return <p className="text-muted-foreground">Aucune commande ajoutée.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {orders.map((order) => {
        const pickup = order.pickup_site_id ? siteMap.get(order.pickup_site_id) : undefined;
        const delivery = order.delivery_site_id ? siteMap.get(order.delivery_site_id) : undefined;

        const pickupName = pickup?.name ?? "Site inconnu";
        const deliveryName = delivery?.name ?? "Site inconnu";

        const pickupSub =
          pickup ? `${getCity(pickup)}${pickup.address ? ` · ${pickup.address}` : ""}` : "—";
        const deliverySub =
          delivery ? `${getCity(delivery)}${delivery.address ? ` · ${delivery.address}` : ""}` : "—";

        const weightStr = typeof order.weight === "number" ? `${nf0.format(order.weight)} kg` : "—";
        const surfaceStr = typeof order.surface === "number" ? `${nf2.format(order.surface/SURFACE_SCALE_FACTOR)} ml` : "—";

        return (
          <Card key={order.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Package className="h-5 w-5 text-muted-foreground" aria-hidden />
                  {/* ✅ names only; no UUID, no raw IDs */}
                  <span className="truncate font-semibold">
                    {pickupName} <span className="text-muted-foreground">→</span> {deliveryName}
                  </span>
                </span>

                {onDelete && (
                  <DeleteButton orderId={order.id} onDelete={onDelete} />
                )}
              </CardTitle>

              <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{order.goods_type || "—"}</span>
                <span className="text-muted-foreground">•</span>
                <span>{weightStr}</span>
                <span className="text-muted-foreground">•</span>
                <span>{surfaceStr}</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-2">
              {/* ✅ show names + details, not IDs */}
              <div className="space-y-1">
                <p className="flex items-center gap-2">
                  <Factory className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <strong>Pickup&nbsp;:</strong>
                  <span className="truncate">{pickupName}</span>
                </p>
                <p className="pl-6 text-xs text-muted-foreground truncate">{pickupSub}</p>
              </div>

              <div className="space-y-1">
                <p className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <strong>Delivery&nbsp;:</strong>
                  <span className="truncate">{deliveryName}</span>
                </p>
                <p className="pl-6 text-xs text-muted-foreground truncate">{deliverySub}</p>
              </div>

<div className="mt-2 flex flex-wrap gap-2">
  {order.requires_refrigeration && (
    <Badge variant="secondary" className="inline-flex items-center gap-1">
      <ThermometerSnowflake className="h-3.5 w-3.5" aria-hidden />
      Réfrigéré
    </Badge>
  )}

  {Array.isArray(order.hazardous_types) && order.hazardous_types.length > 0 && (
    <Badge variant="destructive" className="inline-flex items-center gap-1">
      <Zap className="h-3.5 w-3.5" aria-hidden />
      Dangereux
    </Badge>
  )}
</div>

              {order.notes && (
                <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                  <StickyNote className="mt-0.5 h-4 w-4" aria-hidden />
                  {order.notes}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function DeleteButton({ orderId, onDelete }: { orderId: string; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive" className="gap-2">
          <Trash2 className="h-4 w-4" />
          Supprimer
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          {/* ✅ no UUID shown in the dialog text */}
          <AlertDialogTitle>Supprimer cette commande&nbsp;?</AlertDialogTitle>
          <AlertDialogDescription>
            Cette action est irréversible. La commande sera retirée de la liste.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onDelete(orderId);
              setOpen(false);
            }}
          >
            Confirmer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* tolerant helper for various Site shapes */
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

export default memo(OrderList);
