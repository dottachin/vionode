import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { OptimizerResult } from "@/types/optimizer";
import { Badge } from "rizzui/badge";
import { Text } from "rizzui/text";

type Props = {
  result: OptimizerResult | null | undefined;
  title?: string;
  description?: string;
};

function summarize(result?: OptimizerResult | null) {
  if (!result) return null;
  const metrics = result.metrics as any;

  const distanceKm =
    typeof metrics?.total_distance_km === "number"
      ? metrics.total_distance_km
      : typeof metrics?.total_distance === "number"
      ? metrics.total_distance / 1000
      : undefined;

  const durationH =
    typeof metrics?.total_duration_h === "number"
      ? metrics.total_duration_h
      : typeof metrics?.total_duration_s === "number"
      ? metrics.total_duration_s / 3600
      : undefined;

  const co2Kg =
    typeof metrics?.total_co2_emissions_kg === "number"
      ? metrics.total_co2_emissions_kg
      : typeof metrics?.total_co2_emissions_g === "number"
      ? metrics.total_co2_emissions_g / 1000
      : typeof metrics?.total_co2_emissions === "number"
      ? metrics.total_co2_emissions / 1000
      : undefined;

  const vehiclesUsed = metrics?.total_vehicles_used ?? (metrics as any)?.vehicles_used;

  return { distanceKm, durationH, co2Kg, vehiclesUsed };
}

export default function ResultSummary({ result, title = "Summary", description }: Props) {
  const summary = summarize(result);
  if (!summary) return null;

  return (
    <Card className="border border-blue-100/70 shadow-lg">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <Badge color="info" variant="flat" className="text-xs">
          Live metrics
        </Badge>
      </CardHeader>
      <Separator />
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-blue-100/70 bg-blue-50/60 p-3 dark:border-blue-900/40 dark:bg-blue-950/40">
            <Text className="text-xs uppercase text-text-secondary">Total distance</Text>
            <div className="text-lg font-semibold">
              {summary.distanceKm ? `${summary.distanceKm.toFixed(1)} km` : "-"}
            </div>
          </div>
          <div className="rounded-xl border border-blue-100/70 bg-blue-50/60 p-3 dark:border-blue-900/40 dark:bg-blue-950/40">
            <Text className="text-xs uppercase text-text-secondary">Total duration</Text>
            <div className="text-lg font-semibold">
              {summary.durationH ? `${summary.durationH.toFixed(1)} h` : "-"}
            </div>
          </div>
          <div className="rounded-xl border border-blue-100/70 bg-blue-50/60 p-3 dark:border-blue-900/40 dark:bg-blue-950/40">
            <Text className="text-xs uppercase text-text-secondary">CO₂</Text>
            <div className="text-lg font-semibold">
              {summary.co2Kg ? `${summary.co2Kg.toFixed(1)} kg` : "-"}
            </div>
          </div>
          <div className="rounded-xl border border-blue-100/70 bg-blue-50/60 p-3 dark:border-blue-900/40 dark:bg-blue-950/40">
            <Text className="text-xs uppercase text-text-secondary">Vehicles used</Text>
            <div className="text-lg font-semibold">
              {summary.vehiclesUsed ?? "-"}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
