from route_optimizer.logging_config import get_logger
import numpy as np
from typing import List, Dict, Optional, Tuple
from time import perf_counter
from collections import defaultdict
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from route_optimizer.models.schemas import (
    SolverResult,
    Driver,
    Order,
    Site,
    SiteCategoryEnum,
    Vehicule,
)
from .constraints import ConstraintManager
from .callbacks import CallbackManager
from .results import ResultProcessor

logger = get_logger(__name__)


class VRPSolver:
    def __init__(
        self,
        sites: List[Site],
        orders: Optional[List[Order]],
        vehicles: List[Vehicule],
        drivers: List[Driver],
        duration_matrix: np.ndarray,
        distance_matrix: np.ndarray,
        depots: Optional[List[Site]] = None,
        time_slack_sec: int = 3600,
        max_route_seconds: Optional[Dict[str, int]] = None,
        solver_timeout: int = 100,
        solution_limit: int = 10000000,
        max_vehicle_utilization: float = 1.0,
        strategy: str = "PATH_CHEAPEST_ARC",
        metaheuristic: str = "GUIDED_LOCAL_SEARCH",
        optimization_arc: str = "distance",
        fixed_cost_per_route: Optional[float] = None,
    ):
        """Initialize the VRP solver with validated and coherent data."""
        self._init_logging(
            sites,
            orders,
            vehicles,
            drivers,
            time_slack_sec,
            solver_timeout,
            max_vehicle_utilization,
        )

        # Validate and store core data
        self._input_sites = sites or []
        self._input_site_id_to_idx = {site.id: idx for idx, site in enumerate(self._input_sites)}
        self.depots = depots
        self.sites = self._validate_and_index_sites(sites, depots)
        self.orders = self._validate_orders(orders or [])
        self.vehicles = self._validate_vehicles(vehicles, drivers)
        self.drivers = self._validate_drivers(drivers)
        self.fixed_cost_per_route = fixed_cost_per_route

        # Validate matrices and create mappings

        self.duration_matrix = self._validate_matrix(duration_matrix, "duration")
        self.distance_matrix = self._validate_matrix(distance_matrix, "distance")

        # Store parameters
        self.time_slack_sec = time_slack_sec
        self.solver_timeout = solver_timeout
        self.solution_limit = solution_limit
        self.max_vehicle_utilization = max_vehicle_utilization
        self.strategy = strategy
        self.metaheuristic = metaheuristic
        self._validate_ortools_settings()
        self.optimization_arc = optimization_arc
        # Initialize capacity constraints
        self.max_route_seconds = self._calculate_max_route_times(max_route_seconds)
        self.vehicle_weight_capacities = self._calculate_weight_capacities()

        # Precompute node demands
        self._node_demands = self._precompute_node_demands()
        self.unassigned_orders = []

        # Initialize helper classes
        self.constraints = ConstraintManager(self)
        self.callbacks = CallbackManager(self)
        self.results = ResultProcessor(self)

        logger.info("VRPSolver initialized successfully")

    def _init_logging(
        self,
        sites,
        orders,
        vehicles,
        drivers,
        time_slack_sec,
        solver_timeout,
        max_vehicle_utilization,
    ):
        """Log initialization parameters."""
        logger.debug("Initializing VRPSolver with parameters:")
        logger.debug(f"Sites: {len(sites)}, Orders: {len(orders or [])}")
        logger.debug(f"Vehicles: {len(vehicles)}, Drivers: {len(drivers)}")
        logger.debug(f"Time slack: {time_slack_sec}s, Timeout: {solver_timeout}ms")
        logger.debug(f"Max utilization: {max_vehicle_utilization}")

    def _validate_ortools_settings(self):
        if not hasattr(routing_enums_pb2.FirstSolutionStrategy, self.strategy):
            raise ValueError(f"Invalid strategy: {self.strategy}")
        if not hasattr(routing_enums_pb2.LocalSearchMetaheuristic, self.metaheuristic):
            raise ValueError(f"Invalid metaheuristic: {self.metaheuristic}")

    def _validate_and_index_sites(self, sites: List[Site], depots: Optional[List[Site]]) -> List[Site]:
        """Validate sites and create index mappings with depots placed first."""
        if not sites:
            raise ValueError("No sites provided")

        depot_candidates = depots or [
            s for s in sites if s.category == SiteCategoryEnum.DEPOT or getattr(s, "is_depot", False)
        ]
        if not depot_candidates:
            raise ValueError("At least one depot must be specified")

        site_map: Dict[str, Site] = {}
        ordered_sites: List[Site] = []

        # Depots first (preserve input order, dedupe by id)
        for depot in depot_candidates:
            if depot.id in site_map:
                continue
            ordered_sites.append(depot)
            site_map[depot.id] = depot

        # Remaining sites
        for site in sites:
            if site.id in site_map:
                continue
            ordered_sites.append(site)
            site_map[site.id] = site

        self.site_id_to_index = {site.id: idx for idx, site in enumerate(ordered_sites)}
        self.index_to_site_id = {idx: site.id for idx, site in enumerate(ordered_sites)}

        self.depots = [
            site
            for site in ordered_sites
            if site.category == SiteCategoryEnum.DEPOT or getattr(site, "is_depot", False)
        ]
        self.depot_ids = [d.id for d in self.depots]
        self.depot_indices = [self.site_id_to_index[d.id] for d in self.depots]

        # Build matrix reorder indices to align provided matrices with the new depot-first ordering
        self._matrix_reorder_indices = []
        missing_nodes = []
        for site in ordered_sites:
            base_idx = self._input_site_id_to_idx.get(site.id)
            if base_idx is None:
                missing_nodes.append(site.id)
                continue
            self._matrix_reorder_indices.append(base_idx)

        if missing_nodes:
            raise ValueError(
                f"Matrices do not include all depots/sites: missing {', '.join(missing_nodes)}"
            )

        logger.debug("Site ID to index mapping created for multi-depot setup")
        return ordered_sites

    def _validate_orders(self, orders: List[Order]) -> List[Order]:
        """Validate orders and check site references."""
        if not orders:
            logger.info("No orders provided; falling back to site-level demands only")
            return []

        for order in orders:
            if order.source.id not in self.site_id_to_index:
                raise ValueError(
                    f"Order {order.order_id} references invalid source site"
                )
            if order.destination.id not in self.site_id_to_index:
                raise ValueError(
                    f"Order {order.order_id} references invalid destination site"
                )

        return orders

    def _validate_vehicles(
        self, vehicles: List[Vehicule], drivers: List[Driver]
    ) -> List[Vehicule]:
        """Validate vehicles and check driver references."""
        if not vehicles:
            raise ValueError("No vehicles provided")

        valid_driver_ids = {driver.id for driver in drivers}
        filtered: List[Vehicule] = []

        for vehicle in vehicles:
            if not vehicle.driver_ids:
                raise ValueError(
                    f"Vehicle {vehicle.id_vehicule} has no drivers assigned"
                )
            if not any(did in valid_driver_ids for did in vehicle.driver_ids):
                raise ValueError(f"Vehicle {vehicle.id_vehicule} has no valid drivers")
            # Default depot assignment for backward compatibility
            if not getattr(vehicle, "depot_id", None):
                vehicle.depot_id = self.depot_ids[0]
            elif vehicle.depot_id not in self.depot_ids:
                logger.warning(
                    "Vehicle %s skipped: depot_id %s not in provided depots %s",
                    vehicle.id_vehicule,
                    vehicle.depot_id,
                    self.depot_ids,
                )
                continue

            filtered.append(vehicle)

        if not filtered:
            raise ValueError("No valid vehicles after filtering invalid depots")

        return filtered

    def _validate_drivers(self, drivers: List[Driver]) -> List[Driver]:
        """Validate drivers list."""
        if len(drivers) < len(self.vehicles):
            raise ValueError("Insufficient number of drivers")
        return drivers

    def _validate_matrix(self, matrix: np.ndarray, label: str) -> np.ndarray:
        """Validate and clean a distance/duration matrix."""
        if not isinstance(matrix, np.ndarray):
            raise TypeError(f"{label} matrix must be a NumPy array")

        expected_shape = (len(self._input_sites), len(self._input_sites))
        if matrix.shape != expected_shape:
            raise ValueError(
                f"{label} matrix shape mismatch: expected {expected_shape}"
            )

        # Reorder the matrix to match depot-first node ordering
        clean_matrix = matrix[
            np.ix_(self._matrix_reorder_indices, self._matrix_reorder_indices)
        ].copy()
        np.fill_diagonal(clean_matrix, 0)
        clean_matrix[clean_matrix < 0] = 0

        # Check for completely unreachable nodes
        row_sums = clean_matrix.sum(axis=1)
        if any(row_sums == 0):
            unreachable = [self.sites[i].id for i in np.where(row_sums == 0)[0]]
            logger.warning(f"Unreachable nodes in {label} matrix: {unreachable}")

        return clean_matrix

    def _calculate_max_route_times(
        self, route_times: Optional[Dict[str, int]]
    ) -> Dict[str, int]:
        """Calculate maximum route times for each vehicle."""
        if route_times:
            # Validate provided route times
            for vehicle_id, seconds in route_times.items():
                if seconds <= 0:
                    raise ValueError(
                        f"Invalid max route time for {vehicle_id}: {seconds}"
                    )
            return route_times

        # Calculate default route times based on driver availability
        return {
            # v.id_vehicule: int(3600 * self._get_driver(v).max_daily_service_hours)
            v.id_vehicule: int(3600 * 168)
            for v in self.vehicles
        }

    def _calculate_weight_capacities(self) -> Dict[str, float]:
        """Calculate vehicle weight capacities with utilization factor."""
        return {
            v.id_vehicule: v.weight * self.max_vehicle_utilization
            for v in self.vehicles
        }

    def _get_driver(self, vehicle: Vehicule) -> Driver:
        """Get the primary driver for a vehicle."""
        for driver in self.drivers:
            if driver.id in vehicle.driver_ids:
                return driver
        raise ValueError(f"No valid driver for vehicle {vehicle.id_vehicule}")

    def _precompute_node_demands(self) -> Dict[str, Dict[float, float]]:
        """Precompute surface and weight demands for each node with validation."""
        demands = {"surface": defaultdict(float), "weight": defaultdict(float)}

        for order in self.orders:
            try:
                src_idx = self.site_id_to_index[order.source.id]
                dest_idx = self.site_id_to_index[order.destination.id]

                floor = order.floor or 0
                weight = order.weight or 0

                demands["surface"][src_idx] += floor
                demands["surface"][dest_idx] -= floor
                demands["weight"][src_idx] += weight
                demands["weight"][dest_idx] -= weight

            except KeyError as e:
                self.track_unassigned_order(
                    order.order_id, f"Invalid site reference: {str(e)}"
                )

        # Fallback to per-site demand when no orders are provided (multi-depot VRP mode)
        if not self.orders:
            for idx, site in enumerate(self.sites):
                if site.category == SiteCategoryEnum.DEPOT or getattr(site, "is_depot", False):
                    continue
                demands["surface"][idx] += getattr(site, "demand_surface", 0) or 0
                demands["weight"][idx] += getattr(site, "demand_weight", 0) or 0

        return demands

    def _init_routing_model(
        self,
    ) -> Tuple[pywrapcp.RoutingIndexManager, pywrapcp.RoutingModel]:
        """Initialize routing model with multi-depot start/end assignments."""
        # OR-Tools requires a start/end per vehicle; passing empty lists triggers a fatal check.
        starts: List[int] = []
        ends: List[int] = []
        for vehicle in self.vehicles:
            depot_id = getattr(vehicle, "depot_id", None) or self.depot_ids[0]
            depot_node_index = self.site_id_to_index[depot_id]
            starts.append(depot_node_index)
            ends.append(depot_node_index)

        manager = pywrapcp.RoutingIndexManager(
            len(self.sites), len(self.vehicles), starts, ends
        )

        routing = pywrapcp.RoutingModel(manager)

        # Map each vehicle to its home depot
        self.vehicle_start_nodes: Dict[int, int] = {}
        self.vehicle_depot_ids: Dict[int, str] = {}

        for vehicle_idx, vehicle in enumerate(self.vehicles):
            depot_id = getattr(vehicle, "depot_id", None) or self.depot_ids[0]
            depot_node_index = self.site_id_to_index[depot_id]

            self.vehicle_start_nodes[vehicle_idx] = depot_node_index
            self.vehicle_depot_ids[vehicle_idx] = depot_id

            fixed_cost = max(0, int(self._get_fixed_cost_for_vehicle(vehicle)))
            if fixed_cost > 0:
                routing.SetFixedCostOfVehicle(fixed_cost, vehicle_idx)

        return manager, routing

    def _get_time_window(self, site: Site) -> Tuple[int, int]:
        """Get time window in seconds since midnight for a site."""
        start = site.operational_hours.start
        end = site.operational_hours.end
        return (
            start.hour * 3600 + start.minute * 60 + start.second,
            end.hour * 3600 + end.minute * 60 + end.second,
        )

    def _get_fixed_cost_for_vehicle(self, vehicle: Vehicule) -> int:
        """Resolve fixed cost used to minimize the number of active milk runs."""
        if self.fixed_cost_per_route is not None:
            return int(self.fixed_cost_per_route)
        if getattr(vehicle, "fixed_cost", None) is not None:
            try:
                return int(vehicle.fixed_cost)
            except Exception:
                return 0
        try:
            return int(getattr(vehicle, "operational_cost", 0) or 0)
        except Exception:
            return 0

    def _get_service_duration(self, node_idx: int) -> int:
        return self.sites[node_idx].service_time

    def track_unassigned_order(self, order_id: str, reason: str) -> None:
        """Track unassigned orders with reasons."""
        self.unassigned_orders.append({"order_id": order_id, "reason": reason})
        logger.debug(f"Order {order_id} marked as unassigned: {reason}")

    def get_unassigned_orders_details(self) -> List[Dict]:
        """Get detailed information about unassigned orders."""
        return [
            {
                "order_id": o.order_id,
                "reason": next(
                    (
                        u["reason"]
                        for u in self.unassigned_orders
                        if u["order_id"] == o.order_id
                    ),
                    "unknown reason",
                ),
            }
            for o in self.orders
            if any(u["order_id"] == o.order_id for u in self.unassigned_orders)
        ]

    def solve(self) -> SolverResult:
        """Solve the VRP problem with proper timeout handling."""
        start_time = perf_counter()

        try:
            manager, routing = self._init_routing_model()
            # Estimate vehicle→node paths for break injection
            # self.vehicle_to_node_sequence = self.estimate_vehicle_node_sequences()
            self.constraints.add_all_constraints(routing, manager)

            solution = self._solve_with_timeout(routing)

            if not solution:
                logger.warning("No solution found within time limits")
                return self._create_no_solution_result(start_time)

            result = self.results.prepare_results(
                solution, routing, manager, start_time
            )
            result.assignment_details = self.results.extract_assignments(
                solution, routing, manager
            )

            return result

        except Exception as e:
            logger.error("Solver failed", exc_info=True)
            return self._create_error_result(start_time, str(e))

    def _solve_with_timeout(
        self, routing: pywrapcp.RoutingModel
    ) -> Optional[pywrapcp.Assignment]:
        """Configure and run solver with timeout using dynamic strategy and metaheuristic."""

        params = pywrapcp.DefaultRoutingSearchParameters()

        # Dynamically set strategy and metaheuristic if available, else fallback to defaults
        params.first_solution_strategy = getattr(
            routing_enums_pb2.FirstSolutionStrategy,
            getattr(self, "strategy", "PATH_CHEAPEST_ARC"),
        )

        params.local_search_metaheuristic = getattr(
            routing_enums_pb2.LocalSearchMetaheuristic,
            getattr(self, "metaheuristic", "GUIDED_LOCAL_SEARCH"),
        )

        params.solution_limit = self.solution_limit
        params.time_limit.seconds = self.solver_timeout
        params.log_search = True

        return routing.SolveWithParameters(params)

    def _create_no_solution_result(self, start_time: float) -> SolverResult:
        """Create result for no-solution case."""
        return SolverResult(
            status="no_solution",
            routes=[],
            metrics={"solve_time": perf_counter() - start_time},
            unassigned_orders=self.get_unassigned_orders_details(),
        )

    def _create_error_result(self, start_time: float, error_msg: str) -> SolverResult:
        """Create result for error case."""
        return SolverResult(
            status="error",
            routes=[],
            metrics={"solve_time": perf_counter() - start_time},
            unassigned_orders=self.get_unassigned_orders_details(),
            assignment_details={"error": error_msg},
        )

    def estimate_vehicle_node_sequences(self) -> Dict[str, List[int]]:
        """
        Estimate an initial sequence of nodes visited per vehicle
        based on current orders (pickup and delivery pairs).
        This is useful for pre-solve logic like injecting break intervals.
        """
        logger.info("Estimating vehicle-to-node sequences from order data")

        vehicle_to_nodes: Dict[str, List[int]] = {
            v.id_vehicule: [] for v in self.vehicles
        }

        for order in self.orders:
            compatible_vehicles = self.constraints._get_compatible_vehicles(order)

            if not compatible_vehicles:
                self.track_unassigned_order(order.order_id, "no compatible vehicles")
                continue

            # Assign to the first compatible vehicle as a heuristic
            assigned_vehicle_idx = compatible_vehicles[0]
            vehicle_id = self.vehicles[assigned_vehicle_idx].id_vehicule

            pickup_idx = self.site_id_to_index[order.source.id]
            delivery_idx = self.site_id_to_index[order.destination.id]

            vehicle_to_nodes[vehicle_id].append(pickup_idx)
            vehicle_to_nodes[vehicle_id].append(delivery_idx)

            logger.debug(
                f"Order {order.order_id} → vehicle {vehicle_id} (pickup {pickup_idx}, delivery {delivery_idx})"
            )

        # Optionally remove duplicates while preserving order
        for vehicle_id, sequence in vehicle_to_nodes.items():
            seen = set()
            vehicle_to_nodes[vehicle_id] = [
                x for x in sequence if not (x in seen or seen.add(x))
            ]

        return vehicle_to_nodes

    # Delegate callback methods to CallbackManager
    def transit_callback(self, manager, from_index: int, to_index: int) -> int:
        """Delegate transit callback to CallbackManager."""
        return self.callbacks.transit_callback(manager, from_index, to_index)

    def distance_callback(self, manager, from_index: int, to_index: int) -> int:
        """Delegate distance callback to CallbackManager."""
        return self.callbacks.distance_callback(manager, from_index, to_index)

    def surface_callback(self, manager, from_index: int) -> int:
        """Delegate surface callback to CallbackManager."""
        return self.callbacks.surface_callback(manager, from_index)

    def weight_callback(self, manager, from_index: int) -> int:
        """Delegate weight callback to CallbackManager."""
        return self.callbacks.weight_callback(manager, from_index)
