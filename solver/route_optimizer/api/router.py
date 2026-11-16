from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List, Optional, Set, Tuple, Union
from copy import deepcopy
from datetime import datetime

import time
import numpy as np

from route_optimizer.logging_config import get_logger
from route_optimizer.models.schemas import Driver, Order, RoutingRequest, Site, Vehicle, SiteCategoryEnum
from route_optimizer.logic.matching import VehicleOrderMatcher
from route_optimizer.logic.virtualizer import VirtualSiteGenerator
from route_optimizer.logic.matrix import HereMatrixClient
from route_optimizer.solver.vrp_solver import VRPSolver
from route_optimizer.utils.formatting import clean_types

router = APIRouter(
    prefix="/optimization",
    tags=["Route Optimization"],
    responses={404: {"description": "Not found"}},
)
logger = get_logger(__name__)


class OptimizationResponse:
    def __init__(self):
        self.metadata = {"timestamp": datetime.now().isoformat(), "version": "1.0"}
        self.steps = {}


# kg CO₂e per liter; keys must match vehicle.fuel_type exactly
from route_optimizer.solver.constraints import EMISSION_FACTORS_KG_PER_L  # noqa: E402


# ------------------------------ Unit normalizer ------------------------------ #
def _hhmm(seconds: float) -> str:
    try:
        s = max(0, int(seconds or 0))
    except Exception:
        s = 0
    h, rem = divmod(s, 3600)
    m = rem // 60
    return f"{h:02d}:{m:02d}"


def normalize_units(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize units for UI display while keeping legacy fields.
    - Distances: add *_m and *_km
    - Durations: add *_s and *_h (+ hh:mm on stops)
    - CO2: add *_g and *_kg
    Safe to call on both solver output (m, g) and manual output (km, kg).
    """
    out = deepcopy(payload)
    root = out.get("result", out)  # handle both shapes

    # ---- Metrics ----
    metrics = root.get("metrics", {})
    if metrics:
        # Distance (can be meters or km depending on producer)
        if "total_distance" in metrics:
            td = float(metrics.get("total_distance") or 0.0)
            metrics["total_distance_m"] = int(td)
            metrics["total_distance_km"] = round(td / 1000.0, 3)


        # CO2 totals (some producers mislabeled grams as kg)
        if "total_co2_emissions_kg" in metrics:
            val = float(metrics.get("total_co2_emissions_kg") or 0.0)

            metrics["total_co2_emissions_kg"] = round(val , 3)
            metrics["total_co2_emissions_g"] = int(round(val * 1000.0))

        # Average kg/km recompute from normalized values (idempotent)
        km = float(metrics.get("total_distance_km") or 0.0)
        kg = float(metrics.get("total_co2_emissions_kg") or 0.0)
        metrics["avg_co2_per_km_kg"] = round((kg / km), 6) if km else 0.0

    # ---- Routes & Stops ----
    for route in root.get("routes", []):
        # Distance
        d_raw = float(route.get("total_distance") or 0.0)
        route["total_distance_m"] = int(d_raw)
        route["total_distance_km"] = round(d_raw / 1000.0, 3)


        # Duration (always seconds in solver & manual)
        dur = float(route.get("total_duration") or 0.0)
        route["total_duration_s"] = int(round(dur))
        route["total_duration_h"] = round(dur / 3600.0, 2)

        # CO2 (solver/ manual accumulate grams)
        co2_raw = float(route.get("total_co2_emissions") or 0.0)

        route["total_co2_emissions_kg"] = int(round(co2_raw / 1000.0))
        route["total_co2_emissions_g"] = round(co2_raw, 3)

        # Stops
        for stop in route.get("stops", []):
            dm = float(stop.get("distance_to_next") or 0.0)
              # meters
            stop["distance_to_next_m"] = int(round(dm))
            stop["distance_to_next_km"] = round(dm / 1000.0, 3)

            c = float(stop.get("co2_to_next") or 0.0)

            stop["co2_to_next_kg"] = int(round(c / 1000.0))
            stop["co2_to_next_g"] = round(c, 3)

            if "arrival_time" in stop:
                stop["arrival_time_hhmm"] = _hhmm(stop["arrival_time"])  # hh:mm
            if "departure_time" in stop:
                stop["departure_time_hhmm"] = _hhmm(stop["departure_time"])  # hh:mm

    return out


@router.post(
    "/routes",
    summary="Optimize delivery routes (orders - legacy/default)",
    description="Calculates optimal routes for vehicles to fulfill all orders from a single or detected depot",
    response_model=Dict[str, Any],
    responses={
        200: {"description": "Optimization successful"},
        400: {"description": "Invalid input data"},
        500: {"description": "Internal server error"},
    },
)
async def optimize_routes(request: RoutingRequest) -> Dict[str, Any]:
    """Legacy/default orders endpoint (single or detected depots)."""
    return await _run_optimization(request, force_multi_depot=False, milk_run_mode=False)


@router.post(
    "/routes/milk-runs",
    summary="Optimize milk-run routes (stops with no payloads)",
    description="Calculates optimal routes treating orders as stops with zero weight/surface (milk run mode)",
    response_model=Dict[str, Any],
    responses={
        200: {"description": "Optimization successful"},
        400: {"description": "Invalid input data"},
        500: {"description": "Internal server error"},
    },
)
async def optimize_milk_runs(request: RoutingRequest) -> Dict[str, Any]:
    """Milk-run endpoint that zeroes payload demands."""
    return await _run_optimization(request, force_multi_depot=False, milk_run_mode=True)


@router.post(
    "/routes/multi-depot",
    summary="Optimize routes across multiple depots",
    description="Calculates optimal routes where vehicles are tied to depots and the solver assigns sites across depots",
    response_model=Dict[str, Any],
    responses={
        200: {"description": "Optimization successful"},
        400: {"description": "Invalid input data"},
        500: {"description": "Internal server error"},
    },
)
async def optimize_multi_depot(request: RoutingRequest) -> Dict[str, Any]:
    """Multi-depot endpoint that forces multi-depot modeling."""
    return await _run_optimization(request, force_multi_depot=True, milk_run_mode=False)


async def _run_optimization(
    request: RoutingRequest, force_multi_depot: bool, milk_run_mode: bool
) -> Dict[str, Any]:
    """
    Endpoint for optimizing delivery routes based on:
    - Vehicle capabilities
    - Order requirements
    - Time constraints
    - Distance matrices
    """
    logger.debug("Starting route optimization process")
    logger.debug(f"Incoming request: {request.model_dump_json(indent=2)}")

    response = OptimizationResponse()
    matrix_client = HereMatrixClient()

    try:
        # Step 1: Validate input (allow orders to be empty in multi-depot mode if sites are provided)
        validate_input(
            request,
            require_orders=not force_multi_depot,
            allow_sites=force_multi_depot,
            require_depots=force_multi_depot,
        )
        response.steps["input_validation"] = {"status": "success"}

        if milk_run_mode:
            request = _clone_request_with_zero_demands(request)
            response.steps["milk_run_mode"] = {"status": "enabled"}

        # Step 1.5: Mode config
        MODE_CONFIG = {
            "fast": {
                # Quick feasible routes: best when you just need something workable now
                "strategy": "LOCAL_CHEAPEST_INSERTION",
                "metaheuristic": "GUIDED_LOCAL_SEARCH",
                "solver_timeout": 20,            # s
                "solution_limit": 100_000,
            },
            "balanced": {
                # Stronger seed + time to climb: good default for production
                "strategy": "PARALLEL_CHEAPEST_INSERTION",
                "metaheuristic": "GUIDED_LOCAL_SEARCH",
                "solver_timeout": 120,           # s
                "solution_limit": 1_000_000,
            },
            "optimal": {
                # Long-run improvement on tight windows / many constraints
                "strategy": "PARALLEL_CHEAPEST_INSERTION",
                "metaheuristic": "GUIDED_LOCAL_SEARCH",
                "solver_timeout": 300,           # s
                "solution_limit": 10_000_000,
            },
        }
        config = MODE_CONFIG.get(request.solver_mode, MODE_CONFIG["balanced"])

        # Step 2: Vehicle-order matching (skip when no orders in site-demand mode)
        if len(request.orders or []) > 0:
            try:
                matcher = VehicleOrderMatcher(request.vehicles, request.orders)
                order_to_vehicle_map = matcher.match()
                response.steps["vehicle_matching"] = {
                    "status": "success",
                    "matched_orders": len(order_to_vehicle_map),
                    "unmatched_orders": len(request.orders) - len(order_to_vehicle_map),
                }
            except ValueError as e:
                # Gracefully skip matching if orders are empty or invalid in site-demand mode
                if "order" in str(e).lower() and len(request.orders or []) == 0:
                    order_to_vehicle_map = {}
                    response.steps["vehicle_matching"] = {
                        "status": "skipped",
                        "reason": "no orders (site-demand multi-depot mode)",
                    }
                else:
                    raise
        else:
            order_to_vehicle_map = {}
            response.steps["vehicle_matching"] = {
                "status": "skipped",
                "reason": "no orders (site-demand multi-depot mode)",
            }

        # Determine depots and mode
        depot_candidates: List[Site] = request.depots or []
        if not depot_candidates:
            depot_map: Dict[str, Site] = {}
            for order in request.orders:
                for candidate in (order.source, order.destination):
                    if (
                        candidate
                        and candidate.id not in depot_map
                        and (
                            candidate.category == SiteCategoryEnum.DEPOT
                            or getattr(candidate, "is_depot", False)
                        )
                    ):
                        depot_map[candidate.id] = candidate
            depot_candidates = list(depot_map.values())

        if not depot_candidates and request.orders:
            depot_candidates = [request.orders[0].source]

        multi_depot_mode = force_multi_depot or len(depot_candidates) > 1

        # Step 3: Virtualize (only for single-depot mode)
        virtualizer = None
        virtualization_result = None
        updated_orders = request.orders
        depot_sites: List[Site] = depot_candidates
        if not multi_depot_mode:
            virtualizer = VirtualSiteGenerator(request.orders)
            virtualization_result = virtualizer.generate()
            updated_orders = virtualization_result.orders
            depot_sites = [virtualization_result.depot]
            response.steps["virtualization"] = {
                "status": "success",
                "virtual_sites_created": len(virtualization_result.virtual_sites),
            }
            all_sites = prepare_site_list(
                updated_orders,
                depot_sites,
                additional_sites=depot_candidates,
            )
        else:
            # Multi-depot: allow orders to be empty and accept explicit sites list
            response.steps["virtualization"] = {
                "status": "skipped",
                "reason": "multi-depot mode",
                "depots": [d.id for d in depot_candidates],
            }
            explicit_sites = request.sites or []
            all_sites = prepare_site_list(
                updated_orders,
                depot_sites,
                additional_sites=explicit_sites,
            )

        # Step 4: Sites
        response.steps["site_preparation"] = {
            "status": "success",
            "total_sites": len(all_sites),
            "unique_sites": len({s.id for s in all_sites}),
        }

        # Step 5: Matrices
        duration_matrix, distance_matrix = matrix_client.compute_matrix(
            all_sites, updated_orders
        )
        response.steps["matrix_computation"] = {
            "status": "success",
            "matrix_size": f"{len(duration_matrix)}x{len(duration_matrix)}",
        }

        # Step 6: Max route times
        max_route_sec = calculate_route_times(request.vehicles, request.drivers)
        response.steps["time_calculation"] = {
            "status": "success",
            "vehicles_with_limits": len(max_route_sec),
        }

        # Step 7: Solve
        solver = VRPSolver(
            sites=all_sites,
            orders=updated_orders,
            vehicles=request.vehicles,
            drivers=request.drivers,
            duration_matrix=duration_matrix,
            distance_matrix=distance_matrix,
            depots=depot_sites,
            time_slack_sec=request.slack_time_seconds,
            max_route_seconds=max_route_sec,
            strategy=config["strategy"],
            metaheuristic=config["metaheuristic"],
            solver_timeout=config["solver_timeout"],
            solution_limit=config["solution_limit"],
            optimization_arc=request.optimization_arc,
            fixed_cost_per_route=request.fixed_cost_per_route,
        )
        solution = solver.solve()
        response.steps["solving"] = {"status": "success"}

        if virtualizer:
            virtualizer.revert_virtual_sites(solution)
            response.steps["virtual_reversion"] = {"status": "success"}
        else:
            response.steps["virtual_reversion"] = {
                "status": "skipped",
                "reason": "multi-depot mode",
            }

        raw_payload = {
            "result": clean_types(solution),  # keep same frontend shape
            "metadata": response.metadata,
            "steps": response.steps,
        }
        return normalize_units(raw_payload)

    except ValueError as e:
        logger.error(f"Input validation error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Optimization failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Optimization failed",
                "message": str(e),
                "metadata": response.metadata,
                "completed_steps": response.steps,
            },
        )


# ---------------------- Manual stats (no optimization) ---------------------- #

def _build_manual_sequence(request: RoutingRequest, depot_site: Site) -> List[str]:
    """
    Build a manual route sequence from the incoming orders:
      depot -> unique destinations (in the incoming order) -> depot
    """
    seq: List[str] = [depot_site.id]
    seen: Set[str] = set()
    for o in request.orders:
        dest_id = o.destination.id
        if dest_id != depot_site.id and dest_id not in seen:
            seq.append(dest_id)
            seen.add(dest_id)
    seq.append(depot_site.id)
    return seq


def _sum_path(
    sequence_site_ids: List[str],
    all_sites: List[Site],
    duration_matrix: np.ndarray,
    distance_matrix: np.ndarray,
):
    """Return (total_distance_m, total_duration_s, per_leg list of (d_m, dur_s))."""
    id_to_index = {s.id: idx for idx, s in enumerate(all_sites)}
    total_m = 0.0
    total_s = 0.0
    legs: List[Tuple[float, float]] = []
    for i in range(len(sequence_site_ids) - 1):
        a = sequence_site_ids[i]
        b = sequence_site_ids[i + 1]
        ai = id_to_index.get(a)
        bi = id_to_index.get(b)
        if ai is None or bi is None:
            legs.append((0.0, 0.0))
            continue
        d_m = float(distance_matrix[ai, bi])
        t_s = float(duration_matrix[ai, bi])
        if np.isnan(d_m):
            d_m = 0.0
        if np.isnan(t_s):
            t_s = 0.0
        d_m = max(0.0, d_m)
        t_s = max(0.0, t_s)
        total_m += d_m
        total_s += t_s
        legs.append((d_m, t_s))
    return total_m, total_s, legs


def _estimate_utilization(
    request: RoutingRequest,
    vehicles: List[Vehicle],
) -> Tuple[float, float]:
    """Heuristic utilization for manual path."""
    surface_used = sum((o.floor or 0) for o in request.orders)
    weight_used = sum((o.weight or 0) for o in request.orders)
    surface_capacity = sum((v.surface or 0) for v in vehicles)

    try:
        weight_capacity = sum(int(getattr(v, "weight_capacity", 0) or 0) for v in vehicles)
    except Exception:
        weight_capacity = 0
    if weight_capacity <= 0:
        weight_capacity = max(surface_capacity, 1)

    s_util = (surface_used / surface_capacity) if surface_capacity > 0 else 0.0
    w_util = (weight_used / weight_capacity) if weight_capacity > 0 else 0.0
    return max(0.0, min(1.0, s_util)), max(0.0, min(1.0, w_util))


def _compute_co2_for_manual(distance_km: float, vehicles: List[Vehicle]) -> Tuple[float, float]:
    """
    Use the FIRST vehicle for the manual tour:
      - v.fuel_consumption: L/km
      - v.fuel_type: EXACT key from EMISSION_FACTORS_KG_PER_L
    Returns (total_kg, avg_kg_per_km).
    """
    if distance_km <= 0 or not vehicles:
        return 0.0, 0.0
    v = vehicles[0]
    try:
        fuel_consumption = float(getattr(v, "fuel_consumption", 0) or 0)
    except Exception:
        fuel_consumption = 0.0
    if fuel_consumption <= 0:
        logger.warning("Vehicle.fuel_consumption (L/km) missing or invalid; CO2 will be 0")
        return 0.0, 0.0
    fuel = getattr(v, "fuel_type", None)
    if not fuel or fuel not in EMISSION_FACTORS_KG_PER_L:
        logger.warning(f"Vehicle.fuel_type '{fuel}' not in emission factors; CO2 = 0")
        return 0.0, 0.0

    factor = EMISSION_FACTORS_KG_PER_L[fuel]  # kg/L
    total_kg = fuel_consumption * distance_km * factor                # (L/km) * (km) * (kg/L)
    avg_kg_per_km = fuel_consumption * factor                         # (L/km) * (kg/L)
    return float(total_kg), float(avg_kg_per_km)


def _service_time_for(site: Optional[Site]) -> int:
    try:
        st = getattr(site, "service_time", 0) or 0
        return int(st)
    except Exception:
        return 0


# ------------------- NEW helpers for multi-vehicle manual ------------------- #

def get_order_vehicle_id(o: Order) -> Optional[str]:
    """
    Resolve the assigned vehicle id for an order. Supports a few field names to be flexible:
    - o.assigned_vehicle_id
    - o.vehicle_id
    - o.vehicule_id
    - o.metadata['vehicle_id']
    Returns the exact string expected to match Vehicle.id.
    """
    try:
        # direct attributes
        for attr in ("assigned_vehicle_id", "vehicle_id", "vehicule_id"):
            val = getattr(o, attr, None)
            if val:
                return str(val)
        # inside metadata
        md = getattr(o, "metadata", None)
        if isinstance(md, dict):
            vid = md.get("vehicle_id")
            if vid:
                return str(vid)
    except Exception:
        pass
    return None


def _build_manual_sequence_for_vehicle(
    all_orders: List[Order],
    depot_site: Site,
    vehicle_id: str,
) -> List[str]:
    """
    Build a manual route sequence for a specific vehicle from the incoming orders:
      depot -> unique destinations (in the incoming order for that vehicle) -> depot
    """
    seq: List[str] = [depot_site.id]
    seen: Set[str] = set()
    for o in all_orders:
        if get_order_vehicle_id(o) != vehicle_id:
            continue
        dest_id = o.destination.id
        if dest_id != depot_site.id and dest_id not in seen:
            seq.append(dest_id)
            seen.add(dest_id)
    seq.append(depot_site.id)
    return seq


def _compute_co2_for_vehicle(distance_km: float, vehicle: Vehicle) -> Tuple[float, float]:
    """
    CO2 for a given vehicle and distance:
      vehicle.fuel_consumption: L/km
      vehicle.fuel_type: EXACT key from EMISSION_FACTORS_KG_PER_L
    Returns (total_kg, avg_kg_per_km).
    """
    if distance_km <= 0 or vehicle is None:
        return 0.0, 0.0
    try:
        fuel_consumption = float(getattr(vehicle, "fuel_consumption", 0) or 0)
    except Exception:
        fuel_consumption = 0.0
    if fuel_consumption <= 0:
        logger.warning(f"Vehicle {getattr(vehicle,'id','')} fuel_consumption (L/km) missing or invalid; CO2 will be 0")
        return 0.0, 0.0
    fuel = getattr(vehicle, "fuel_type", None)
    if not fuel or fuel not in EMISSION_FACTORS_KG_PER_L:
        logger.warning(f"Vehicle {getattr(vehicle,'id','')} fuel_type '{fuel}' not in emission factors; CO2 = 0")
        return 0.0, 0.0

    factor = EMISSION_FACTORS_KG_PER_L[fuel]  # kg/L
    total_kg = fuel_consumption * distance_km * factor
    avg_kg_per_km = fuel_consumption * factor
    return float(total_kg), float(avg_kg_per_km)


@router.post(
    "/manual-stats",
    summary="Compute metrics for the provided manual sequence (no optimization)",
    description=(
        "Computes distance, timing, and simple utilization metrics for one route per vehicle, "
        "based on per-order vehicle assignments (depot → that vehicle's unique destinations in given order → depot), "
        "using HERE matrices. No OR-Tools optimization is performed."
    ),
    response_model=Dict[str, Any],
    responses={
        200: {"description": "Manual stats computed"},
        400: {"description": "Invalid input data"},
        500: {"description": "Internal server error"},
    },
)
async def manual_stats(request: RoutingRequest) -> Dict[str, Any]:
    """
    Returns the SAME SHAPE as /optimization/routes:
      { result: OptimizerResult, metrics?: Metrics, solver_run_id?: null, result_id?: null }

    Assumptions:
    - Each Order may specify its vehicle via one of:
        order.assigned_vehicle_id | order.vehicle_id | order.vehicule_id | order.metadata['vehicle_id']
    - Orders without a valid assigned vehicle are reported under 'unassigned_orders' and not routed.
    """
    logger.debug("Starting manual stats computation (multi-vehicle)")
    logger.debug(f"Incoming manual request: {request.model_dump_json(indent=2)}")

    response = OptimizationResponse()
    matrix_client = HereMatrixClient()

    try:
        # Validate basics
        validate_input(request)
        response.steps["input_validation"] = {"status": "success"}

        # Virtualize like the optimizer does (keeps shapes consistent)
        virtualizer = VirtualSiteGenerator(request.orders)
        virtualization_result = virtualizer.generate()
        updated_orders = virtualization_result.orders
        depot = virtualization_result.depot
        response.steps["virtualization"] = {
            "status": "success",
            "virtual_sites_created": len(virtualization_result.virtual_sites),
        }

        # Sites & matrix (single matrix for all sites & all vehicles)
        all_sites = prepare_site_list(updated_orders, depot)
        response.steps["site_preparation"] = {
            "status": "success",
            "total_sites": len(all_sites),
            "unique_sites": len({s.id for s in all_sites}),
        }

        t0 = time.perf_counter()
        duration_matrix, distance_matrix = matrix_client.compute_matrix(
            all_sites, updated_orders
        )
        t1 = time.perf_counter()
        response.steps["matrix_computation"] = {
            "status": "success",
            "elapsed_s": round(t1 - t0, 3),
            "matrix_size": f"{len(duration_matrix)}x{len(duration_matrix)}",
        }

        # Index helpers
        site_by_id = {s.id: s for s in all_sites}
        veh_by_id = {v.id: v for v in request.vehicles}

        # Group orders by assigned vehicle
        vehicle_to_orders: Dict[str, List[Order]] = {}
        unassigned_orders: List[str] = []
        for o in updated_orders:
            vid = get_order_vehicle_id(o)
            if vid and vid in veh_by_id:
                vehicle_to_orders.setdefault(vid, []).append(o)
            else:
                # keep original order_id for reporting
                try:
                    unassigned_orders.append(o.order_id)
                except Exception:
                    unassigned_orders.append(str(getattr(o, "id", "unknown")))

        routes: List[Dict[str, Any]] = []
        assignment_vehicle_stats: Dict[str, Dict[str, Any]] = {}

        # Fleet aggregates
        fleet_total_m = 0.0
        fleet_total_s = 0.0
        fleet_total_co2_kg = 0.0
        fleet_surface_used = 0
        fleet_surface_capacity = 0
        fleet_weight_used = 0
        fleet_weight_capacity = 0

        # Build one route per vehicle (in input order of vehicles)
        for v in request.vehicles:
            veh_id = v.id
            orders_v = vehicle_to_orders.get(veh_id, [])
            if not orders_v:
                continue

            # Sequence for this vehicle
            sequence = _build_manual_sequence_for_vehicle(updated_orders, depot, veh_id)
            total_m, total_s, legs = _sum_path(sequence, all_sites, duration_matrix, distance_matrix)
            total_km = total_m / 1000.0

            # Per-vehicle CO2
            total_co2_kg, avg_co2_per_km_kg = _compute_co2_for_vehicle(total_km, v)

            # Stops timeline for this vehicle
            stops: List[Dict[str, Any]] = []
            now_arrival = 0.0
            for i, site_id in enumerate(sequence):
                site_obj = site_by_id.get(site_id)
                st = _service_time_for(site_obj)
                departure_time = now_arrival + st
                dist_to_next = float(legs[i][0]) if i < len(legs) else 0.0
                co2_leg_kg = avg_co2_per_km_kg * (dist_to_next / 1000.0) if avg_co2_per_km_kg > 0 else 0.0

                stops.append({
                    "site_id": site_id,
                    "arrival_time": int(now_arrival),
                    "service_time": int(st),
                    "departure_time": int(departure_time),
                    "surface": 0,
                    "weight": 0,
                    "distance_to_next": int(round(dist_to_next)),   # meters
                    "co2_to_next": float(co2_leg_kg * 1000.0),      # grams
                })

                # advance to next site's arrival by adding travel time
                if i < len(legs):
                    now_arrival = departure_time + float(legs[i][1])

            # Vehicle-level loads & capacities
            route_surface = int(sum((o.floor or 0) for o in orders_v))
            route_weight = int(sum((o.weight or 0) for o in orders_v))
            v_surface_cap = int(getattr(v, "surface", 0) or 0)
            try:
                v_weight_cap = int(getattr(v, "weight_capacity", 0) or 0)
            except Exception:
                v_weight_cap = 0

            # Pick a driver (first if provided)

            route = {
                "vehicle_id": veh_id,
                "driver_ids": v.driver_ids,
                "stops": stops,
                "total_distance": int(round(total_m)),  # meters
                "total_duration": int(round(total_s + sum(_service_time_for(site_by_id.get(sid)) for sid in sequence))),  # seconds
                "total_surface": route_surface,
                "total_weight": route_weight,
                "total_co2_emissions": float(total_co2_kg * 1000.0),  # grams
            }
            routes.append(route)

            # Assignment details per vehicle
            assigned_order_ids = sorted([
                getattr(o, "order_id", getattr(o, "id", "unknown")) for o in orders_v
            ])
            assignment_vehicle_stats[veh_id] = {
                "assigned_orders": assigned_order_ids,
                "surface_used": route_surface,
                "surface_capacity": v_surface_cap,
                "weight_used": route_weight,
                "weight_capacity": v_weight_cap,
            }

            # Fleet aggregates
            fleet_total_m += total_m
            fleet_total_s += total_s
            fleet_total_co2_kg += total_co2_kg
            fleet_surface_used += route_surface
            fleet_surface_capacity += v_surface_cap
            fleet_weight_used += route_weight
            fleet_weight_capacity += (v_weight_cap if v_weight_cap > 0 else v_surface_cap)

        # Metrics (manual "producer": distance is in km, CO2 in kg)
        total_km = fleet_total_m / 1000.0
        surface_util = (fleet_surface_used / fleet_surface_capacity) if fleet_surface_capacity > 0 else 0.0
        weight_util = (fleet_weight_used / fleet_weight_capacity) if fleet_weight_capacity > 0 else 0.0
        avg_co2_per_km_kg = (fleet_total_co2_kg / total_km) if total_km > 0 else 0.0

        optimizer_result = {
            "status": "success",
            "routes": routes,
            "metrics": {
                "solve_time": round(time.perf_counter() - t0, 3),
                "total_distance": float(total_km),                 # km (manual producer)
                "total_vehicles_used": int(len(routes)),
                "unassigned_orders": int(len(unassigned_orders)),
                "surface_utilization": float(max(0.0, min(1.0, surface_util))),
                "weight_utilization": float(max(0.0, min(1.0, weight_util))),
                "total_co2_emissions_kg": float(fleet_total_co2_kg),  # kg (manual producer)
                "avg_co2_per_km_kg": float(avg_co2_per_km_kg),
                "virtual_sites_reverted": 0,
            },
            "unassigned_orders": unassigned_orders,  # explicit list for UI
            "metadata": {
                "timestamp": datetime.now().isoformat(),
                "version": "manual-1.1-multiveh",
            },
            "assignment_details": {
                "vehicle_assignments": assignment_vehicle_stats,
                "unassigned_orders": unassigned_orders,
            },
        }

        raw_payload = {
            "result": clean_types(optimizer_result),
            "metadata": response.metadata,
            "steps": response.steps,
            "solver_run_id": None,
            "result_id": None,
        }
        return normalize_units(raw_payload)

    except ValueError as e:
        logger.error(f"Manual stats input error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Manual stats failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Manual stats failed",
                "message": str(e),
                "metadata": response.metadata,
                "completed_steps": response.steps,
            },
        )


# ------------------------------ Shared helpers ------------------------------ #

def validate_input(
    request: RoutingRequest,
    require_orders: bool = True,
    allow_sites: bool = False,
    require_depots: bool = False,
) -> None:
    """Validate routing request input with mode-aware flags."""
    if require_orders and not request.orders:
        raise ValueError("At least one order is required")

    if not require_orders and not request.orders and not (allow_sites and request.sites):
        raise ValueError("Provide at least one order or a non-empty sites list for multi-depot mode")

    if require_depots and not request.depots:
        raise ValueError("At least one depot is required for multi-depot optimization")

    if not request.vehicles:
        raise ValueError("At least one vehicle is required")
    if len(request.drivers) < len(request.vehicles):
        raise ValueError("Not enough drivers for all vehicles")


def _clone_request_with_zero_demands(request: RoutingRequest) -> RoutingRequest:
    """Return a copy of the request with order demands set to zero (milk run mode)."""
    req_copy = deepcopy(request)
    zero_orders: List[Order] = []
    for order in req_copy.orders:
        order_copy = order.model_copy(deep=True)
        order_copy.floor = 0
        order_copy.weight = 0
        zero_orders.append(order_copy)
    req_copy.orders = zero_orders
    return req_copy


def prepare_site_list(
    orders: List[Order],
    depot_site: Optional[Union[Site, List[Site]]] = None,
    additional_sites: Optional[List[Site]] = None,
) -> List[Site]:
    """Prepare unified site list with depot(s) first."""
    site_map: Dict[str, Site] = {}
    added_original_sources: Set[str] = set()
    for order in orders:
        source = order.source
        dest = order.destination
        site_map[source.id] = source

        if (
            hasattr(source, "metadata")
            and isinstance(source.metadata, dict)
            and source.metadata.get("is_virtual") is True
            and "original_site_id" in source.metadata
        ):
            original_id = source.metadata["original_site_id"]
            if original_id not in site_map and original_id not in added_original_sources:
                original_site = Site(
                    id=original_id,
                    name=f"{source.name} (Original)",
                    coordinates=source.coordinates,
                    category=source.category,
                    address=source.address,
                    metadata={"is_virtual": False, "restored_from": source.id},
                )
                site_map[original_site.id] = original_site
                added_original_sources.add(original_site.id)

        site_map[dest.id] = dest
    if additional_sites:
        for site in additional_sites:
            if site.id not in site_map:
                site_map[site.id] = site

    depot_sites: List[Site] = []
    if depot_site:
        depot_sites = depot_site if isinstance(depot_site, list) else [depot_site]

    ordered_sites: List[Site] = []
    seen: Set[str] = set()
    for depot in depot_sites or []:
        if depot.id in seen:
            continue
        ordered_sites.append(depot)
        seen.add(depot.id)

    for site in site_map.values():
        if site.id in seen:
            continue
        ordered_sites.append(site)
        seen.add(site.id)

    return ordered_sites


def calculate_route_times(
    vehicles: List[Vehicle], drivers: List[Driver]
) -> Dict[str, int]:
    """Sum driver max_daily_service_hours per vehicle -> seconds."""
    result: Dict[str, int] = {}
    driver_map = {d.id: d for d in drivers}
    for v in vehicles:
        total_hours = 0
        ids = getattr(v, "driver_ids", None) or []
        if ids:
            valid = False
            for did in ids:
                if did in driver_map:
                    total_hours += driver_map[did].max_daily_service_hours
                    valid = True
            if not valid:
                total_hours = 12
        else:
            total_hours = 12
        result[v.id] = int(total_hours * 3600)
    return result
