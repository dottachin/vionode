import type {
  OptimizerInput,
  OptimizerOrder,
} from "@/types/optimizer"
import type { Site } from "@/types/site"
import type { Vehicle, Driver } from "@/types/vehicle"

/**
 * Generate OptimizerInput from a depot and milk run site IDs
 */
export function generateOptimizerInputFromMilkRun(
  depot: Site,
  siteIds: string[],
  siteMap: Record<string, Site>,
  vehicles: Vehicle[],
  drivers: Driver[],
  defaults = {
    weight: 0,
    surface: 0,
    priority: 1,
  }
): OptimizerInput {
  // Do NOT mutate the incoming depot; create a normalized copy
  const depotAsDept: Site = { ...depot, category: "depot" }

  const orders: OptimizerOrder[] = siteIds.map((siteId, index) => {
    const destination = siteMap[siteId]
    if (!destination) {
      throw new Error(`Site ID ${siteId} not found in site map`)
    }

    return {
      order_id: `milkrun-${siteId}`,
      weight: defaults.weight,
      floor: defaults.surface,
      hazardous_types: [],
      required_utilities: [],
      source: depotAsDept,        // ← always "dept"
      destination,
      priority: defaults.priority + index,
    }
  })

  return {
    depots: [{ ...depotAsDept } as any],
    vehicles: vehicles.map((v) => ({ ...v, depot_id: undefined })) as Vehicle[],
    drivers,
    orders,
    slack_time_seconds: 0,
    optimization_arc: "distance",
    solver_mode: "balanced",
  }
}
