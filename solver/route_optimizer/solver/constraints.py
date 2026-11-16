from typing import List
from route_optimizer.logging_config import get_logger
from route_optimizer.models.schemas import EquipmentEnum, Order, SiteCategoryEnum

logger = get_logger(__name__)


# --- Same factors as in manual stats (keys must match vehicle.fuel_type exactly) ---
EMISSION_FACTORS_KG_PER_L = {
    "Bioethanol - ED95": 0.85,
    "Petrol - Unleaded (95, E10, 98)": 2.70,
    "Diesel - B30": 2.64,
    "Off-road diesel": 3.16,
    "Road diesel - B100": 1.22,
    "Road diesel - B7": 3.10,
    "HVO - Hydrotreated vegetable oil": 0.54,
    "Kerosene - Jet A1 / A": 3.15,
    "Electricity (2022 average mix)": 0.05,
}


def _vehicle_emission_rate_g_per_m(vehicle) -> float:
    """
    CO₂ rate in grams per meter using the SAME formula as manual stats:
      rate_g_per_m = fuel_consumption(L/km) * factor(kg/L)
    (Numerically equals g/m because kg/km * 1000(g/kg) / 1000(m/km) = 1)
    """
    try:
        fuel_consumption = float(getattr(vehicle, "fuel_consumption", 0) or 0)  # L/km
    except Exception:
        fuel_consumption = 0.0

    fuel = getattr(vehicle, "fuel_type", None)

    if fuel_consumption <= 0:
        logger.warning("Vehicle.fuel_consumption (L/km) missing or invalid; CO₂ rate set to 0")
        return 0.0
    if not fuel or fuel not in EMISSION_FACTORS_KG_PER_L:
        logger.warning(f"Vehicle.fuel_type '{fuel}' not in emission factors; CO₂ rate set to 0")
        return 0.0

    factor_kg_per_L = float(EMISSION_FACTORS_KG_PER_L[fuel])  # kg/L
    rate_g_per_m = fuel_consumption * factor_kg_per_L  # g/m numerically
    return max(0.0, float(rate_g_per_m))


class ConstraintManager:
    def __init__(self, solver):
        logger.info("Initializing ConstraintManager")
        logger.debug(f"Creating ConstraintManager with solver: {solver}")
        self.solver = solver
        self._order_compatibility_cache = {}
        logger.debug("ConstraintManager initialized with empty compatibility cache")

    def add_all_constraints(self, routing, manager):
        """Add all constraints to the routing model."""
        logger.info("Adding all constraints to routing model")
        logger.debug(f"Routing model: {routing}, Manager: {manager}")

        try:
            self._add_time_constraints(routing, manager)
            self._add_distance_dimension(routing, manager)
            self._add_capacity_constraints(routing, manager)
            self._add_pickup_delivery_constraints(routing, manager)
            self._add_transit_constraints(routing, manager)
            self._add_co2_dimension(routing, manager)

            # self._add_break_constraints(routing, manager)
            logger.info("Successfully added all constraints")
        except Exception as e:
            logger.error(f"Failed to add constraints: {str(e)}", exc_info=True)
            raise

    def _add_transit_constraints(self, routing, manager):
        """Add transit cost based on selected arc type (distance, duration, or CO2)."""
        logger.debug("Adding transit constraints")

        try:
            if self.solver.optimization_arc == "co2":
                logger.debug("Optimization arc is CO2 - setting vehicle-specific arc costs")

                def make_callback(rate_g_per_m: float):
                    def co2_callback(from_idx, to_idx):
                        from_node = manager.IndexToNode(from_idx)
                        to_node = manager.IndexToNode(to_idx)
                        dist_m = self.solver.distance_matrix[from_node][to_node]
                        # cost in grams (int)
                        return int(max(0.0, dist_m) * rate_g_per_m)
                    return co2_callback

                for vehicle_idx, vehicle in enumerate(self.solver.vehicles):
                    rate = _vehicle_emission_rate_g_per_m(vehicle)
                    cb_index = routing.RegisterTransitCallback(make_callback(rate))
                    routing.SetArcCostEvaluatorOfVehicle(cb_index, vehicle_idx)
                    logger.debug(f"Set CO2 arc evaluator for vehicle {vehicle_idx}: rate={rate} g/m")

                logger.info("CO₂-based arc cost evaluators set per vehicle")

            else:
                # fallback to shared arc cost (distance/duration)
                logger.debug("Using shared arc cost based on distance/duration")

                def arc_cost_callback_wrapper(from_idx, to_idx):
                    try:
                        if self.solver.optimization_arc == "distance":
                            result = self.solver.distance_callback(manager, from_idx, to_idx)
                        elif self.solver.optimization_arc == "duration":
                            result = self.solver.transit_callback(manager, from_idx, to_idx)
                        else:
                            raise ValueError(
                                f"Unsupported optimization_arc: {self.solver.optimization_arc}"
                            )
                        logger.debug(f"Arc cost result for {from_idx}->{to_idx}: {result}")
                        return int(result)
                    except Exception as e:
                        logger.error(
                            f"Error in arc cost callback for {from_idx}->{to_idx}: {e}",
                            exc_info=True,
                        )
                        return 1_000_000  # fallback cost

                callback_index = routing.RegisterTransitCallback(arc_cost_callback_wrapper)
                routing.SetArcCostEvaluatorOfAllVehicles(callback_index)
                logger.debug("Set arc cost evaluator using distance or duration")

        except Exception as e:
            logger.error(f"Failed to add transit constraints: {str(e)}", exc_info=True)
            raise

    def _add_distance_dimension(self, routing, manager):
        """Add a distance dimension using the distance matrix regardless of arc cost."""
        logger.info("Adding distance dimension")

        try:
            def distance_callback_wrapper(from_idx, to_idx):
                result = self.solver.distance_callback(manager, from_idx, to_idx)
                return int(result)

            callback_index = routing.RegisterTransitCallback(distance_callback_wrapper)
            logger.debug(f"Registered distance callback with index: {callback_index}")

            vehicle_max_distance = [v.max_distance_meters for v in self.solver.vehicles]

            routing.AddDimensionWithVehicleCapacity(
                callback_index,
                0,  # slack
                vehicle_max_distance,
                True,  # start cumul at 0
                "Distance",
            )
            logger.info("Added Distance dimension successfully")

        except Exception as e:
            logger.error(f"Failed to add Distance dimension: {str(e)}", exc_info=True)
            raise

    def _add_capacity_constraints(self, routing, manager):
        """Add surface and weight capacity constraints."""
        logger.info("Adding capacity constraints")

        try:
            # Surface capacity
            logger.debug("Adding surface capacity constraints")

            def surface_callback_wrapper(from_idx):
                result = self.solver.surface_callback(manager, from_idx)
                logger.debug(f"Surface callback for index {from_idx}: {result}")
                return int(result)

            surface_cb_idx = routing.RegisterUnaryTransitCallback(
                lambda index: surface_callback_wrapper(index)
            )
            logger.debug(f"Registered surface callback with index: {surface_cb_idx}")

            surface_capacities = [
                int(getattr(v, "surface", 0) * self.solver.max_vehicle_utilization)
                for v in self.solver.vehicles
            ]
            logger.debug(f"Surface capacities: {surface_capacities}")

            routing.AddDimensionWithVehicleCapacity(
                surface_cb_idx,
                0,  # null capacity slack
                surface_capacities,
                True,  # start cumul to zero
                "Surface",
            )
            logger.debug("Added surface dimension with vehicle capacity")

            # Weight capacity
            logger.debug("Adding weight capacity constraints")

            def weight_callback_wrapper(from_idx):
                result = self.solver.weight_callback(manager, from_idx)
                logger.debug(f"Weight callback for index {from_idx}: {result}")
                return int(result)

            weight_cb_idx = routing.RegisterUnaryTransitCallback(
                lambda index: weight_callback_wrapper(index)
            )
            logger.debug(f"Registered weight callback with index: {weight_cb_idx}")

            weight_capacities = [
                int(self.solver.vehicle_weight_capacities[v.id])
                for v in self.solver.vehicles
            ]
            logger.debug(f"Weight capacities: {weight_capacities}")

            routing.AddDimensionWithVehicleCapacity(
                weight_cb_idx,
                0,  # null capacity slack
                weight_capacities,
                True,  # start cumul to zero
                "Weight",
            )
            logger.debug("Added weight dimension with vehicle capacity")

            # Ensure OR-Tools evaluates capacity dimensions at all nodes
            logger.debug("Setting up dimension finalizers")
            surface_dim = routing.GetDimensionOrDie("Surface")
            weight_dim = routing.GetDimensionOrDie("Weight")
            logger.debug(f"Retrieved dimensions - Surface: {surface_dim}, Weight: {weight_dim}")

            for v_idx in range(len(self.solver.vehicles)):
                routing.solver().Add(surface_dim.CumulVar(routing.Start(v_idx)) >= 0)
                routing.solver().Add(weight_dim.CumulVar(routing.Start(v_idx)) >= 0)

        except Exception as e:
            logger.error(f"Failed to add capacity constraints: {str(e)}", exc_info=True)
            raise

    def _add_pickup_delivery_constraints(self, routing, manager):
        """Add pickup and delivery constraints for orders."""
        logger.info("Adding pickup and delivery constraints")

        try:
            time_dim = routing.GetDimensionOrDie("Time")
            surface_dim = routing.GetDimensionOrDie("Surface")
            weight_dim = routing.GetDimensionOrDie("Weight")
            logger.debug(
                f"Retrieved dimensions - Time: {time_dim}, Surface: {surface_dim}, Weight: {weight_dim}"
            )
            if not self.solver.orders:
                logger.info("No orders provided; skipping pickup and delivery pairing")
                return

            for order_idx, order in enumerate(self.solver.orders):
                logger.debug(
                    f"Processing order {order_idx + 1}/{len(self.solver.orders)}: {order.order_id}"
                )

                try:
                    pickup_idx = manager.NodeToIndex(self.solver.site_id_to_index[order.source.id])
                    delivery_idx = manager.NodeToIndex(self.solver.site_id_to_index[order.destination.id])
                    logger.debug(f"Converted to indices - pickup: {pickup_idx}, delivery: {delivery_idx}")

                    pickup_is_start_or_end = routing.IsStart(pickup_idx) or routing.IsEnd(pickup_idx)
                    delivery_is_start_or_end = routing.IsStart(delivery_idx) or routing.IsEnd(delivery_idx)

                    if routing.IsStart(pickup_idx) and routing.IsStart(delivery_idx):
                        logger.warning(
                            f"Order {order.order_id} has pickup and delivery at depot - marking unassigned"
                        )
                        self.solver.track_unassigned_order(order.order_id, "pickup/delivery at depot")
                        continue

                    compatible_vehicles = self._get_compatible_vehicles(order)
                    logger.debug(f"Compatible vehicles for order {order.order_id}: {compatible_vehicles}")

                    if not compatible_vehicles:
                        logger.warning(f"No compatible vehicles found for order {order.order_id}")
                        self.solver.track_unassigned_order(order.order_id, "no compatible vehicles")
                        continue

                    # When pickup or delivery sits on a start/end node (e.g., depot-origin orders),
                    # avoid applying pickup&delivery constraints or allowed-vehicle filters to start/end
                    # indices, as OR-Tools expects those to stay fixed per vehicle.
                    if pickup_is_start_or_end or delivery_is_start_or_end:
                        if not pickup_is_start_or_end:
                            routing.SetAllowedVehiclesForIndex([int(v) for v in compatible_vehicles], int(pickup_idx))
                        if not delivery_is_start_or_end:
                            routing.SetAllowedVehiclesForIndex([int(v) for v in compatible_vehicles], int(delivery_idx))
                        logger.debug(
                            f"Skipped pickup/delivery pairing for order {order.order_id} "
                            f"(start/end involvement). Applied allowed vehicles to non-start nodes."
                        )
                        continue

                    routing.AddPickupAndDelivery(pickup_idx, delivery_idx)
                    logger.debug("Added pickup and delivery pair")

                    routing.solver().Add(
                        routing.VehicleVar(pickup_idx) == routing.VehicleVar(delivery_idx)
                    )
                    logger.debug("Added vehicle equality constraint")

                    routing.solver().Add(
                        time_dim.CumulVar(pickup_idx) <= time_dim.CumulVar(delivery_idx)
                    )
                    logger.debug("Added time sequence constraint")

                    # Keep capacity dimensions monotonic if needed in your solver
                    # routing.solver().Add(surface_dim.CumulVar(pickup_idx) <= surface_dim.CumulVar(delivery_idx))
                    # routing.solver().Add(weight_dim.CumulVar(pickup_idx) <= weight_dim.CumulVar(delivery_idx))

                    routing.SetAllowedVehiclesForIndex([int(v) for v in compatible_vehicles], int(pickup_idx))
                    routing.SetAllowedVehiclesForIndex([int(v) for v in compatible_vehicles], int(delivery_idx))
                    logger.debug(f"Set allowed vehicles for order {order.order_id}")

                except KeyError as ke:
                    logger.error(f"KeyError processing order {order.order_id}: {str(ke)}", exc_info=True)
                    self.solver.track_unassigned_order(order.order_id, "invalid site reference")
                except Exception as e:
                    logger.error(f"Error processing order {order.order_id}: {str(e)}", exc_info=True)
                    raise

            logger.info(f"Processed {len(self.solver.orders)} orders")
        except Exception as e:
            logger.error("Failed to add pickup/delivery constraints: {str(e)}", exc_info=True)
            raise

    def _get_compatible_vehicles(self, order: Order) -> List[int]:
        """Get list of vehicle indices compatible with the order."""
        logger.debug(f"Checking vehicle compatibility for order {order.order_id}")

        if order.order_id in self._order_compatibility_cache:
            logger.debug(f"Found cached compatibility for order {order.order_id}")
            return self._order_compatibility_cache[order.order_id]

        compatible: List[int] = []
        logger.debug(
            f"Order requirements - Utilities: {order.required_utilities}, "
            f"Floor: {order.floor}, Weight: {order.weight}, "
            f"Hazardous: {order.hazardous_types}"
        )

        for i, vehicle in enumerate(self.solver.vehicles):
            logger.debug(f"Checking vehicle {i}: {vehicle.id}")

            # Check utility requirements
            missing_utilities = [
                req for req in order.required_utilities if req not in vehicle.equipment
            ]
            if missing_utilities:
                logger.debug(f"Vehicle {i} missing utilities: {missing_utilities}")
                continue

            # Check surface capacity
            max_surface = getattr(vehicle, "surface", 0) * self.solver.max_vehicle_utilization
            if order.floor > max_surface:
                logger.debug(f"Vehicle {i} insufficient surface: {max_surface} < {order.floor}")
                continue

            # Check weight capacity
            vehicle_weight_cap = self.solver.vehicle_weight_capacities[vehicle.id]
            if order.weight and order.weight > vehicle_weight_cap:
                logger.debug(
                    f"Vehicle {i} insufficient weight capacity: {vehicle_weight_cap} < {order.weight}"
                )
                continue

            # Check hazardous materials
            if order.hazardous_types and EquipmentEnum.HAZARDOUS_MATERIAL_CONTAINER not in vehicle.equipment:
                logger.debug(f"Vehicle {i} lacks hazardous materials containers")
                continue

            compatible.append(i)
            logger.debug(f"Vehicle {i} is compatible with order {order.order_id}")

        self._order_compatibility_cache[order.order_id] = compatible
        logger.debug(f"Cached compatible vehicles for order {order.order_id}: {compatible}")
        return compatible

    def _add_time_constraints(self, routing, manager):
        """Add time constraints for all sites and vehicles based on operational time windows."""
        logger.info("Adding time constraints")
        try:
            # Register the time transit callback
            def time_callback_wrapper(from_index, to_index):
                return int(self.solver.transit_callback(manager, from_index, to_index))

            transit_callback_index = routing.RegisterTransitCallback(time_callback_wrapper)
            logger.debug(f"Registered time transit callback with index: {transit_callback_index}")

            depot_start_times = []
            depot_end_times = []
            for vehicle_idx, vehicle in enumerate(self.solver.vehicles):
                depot_id = getattr(vehicle, "depot_id", None) or self.solver.depot_ids[0]
                depot_site = next(
                    (d for d in self.solver.depots if d.id == depot_id),
                    self.solver.sites[self.solver.site_id_to_index[depot_id]],
                )
                start, end = self.solver._get_time_window(depot_site)
                depot_start_times.append(start)
                depot_end_times.append(end)
                logger.debug(
                    f"Vehicle {vehicle_idx} depot {depot_id} time window: {start}-{end}"
                )

            horizon_capacities = depot_end_times
            # Use depot-specific end as max capacity for time dimension
            routing.AddDimensionWithVehicleCapacity(
                transit_callback_index,
                self.solver.time_slack_sec,
                horizon_capacities,  # capacity per vehicle
                False,
                "Time",
            )
            time_dim = routing.GetDimensionOrDie("Time")

            # Apply time windows to all sites
            for site_idx, site in enumerate(self.solver.sites):
                site_start, site_end = self.solver._get_time_window(site)
                node_index = manager.NodeToIndex(site_idx)
                time_dim.CumulVar(node_index).SetRange(site_start, site_end)
                logger.debug(
                    f"Set time window for site {site.id} (routing index {node_index}): {site_start}-{site_end}"
                )

            # Apply time windows and max route duration for all vehicles
            for vehicle_idx, vehicle in enumerate(self.solver.vehicles):
                start_index = routing.Start(vehicle_idx)
                end_index = routing.End(vehicle_idx)

                depot_start = depot_start_times[vehicle_idx]
                depot_end = depot_end_times[vehicle_idx]

                # Depot-based start/end time windows
                time_dim.CumulVar(start_index).SetRange(depot_start, depot_end)
                time_dim.CumulVar(end_index).SetRange(depot_start, depot_end)

                # Per-vehicle max route duration
                max_sec = self.solver.max_route_seconds[vehicle.id]
                routing.solver().Add(
                    time_dim.CumulVar(end_index) - time_dim.CumulVar(start_index) <= max_sec
                )

                logger.debug(
                    f"Vehicle {vehicle_idx} time window: {depot_start}-{depot_end}, "
                    f"Max route duration: {max_sec} seconds"
                )

        except Exception as e:
            logger.error(f"Failed to add time constraints: {str(e)}", exc_info=True)
            raise

    def _add_break_constraints(
        self,
        routing,
        manager,
        work_time_sec: int = 20 * 3600,
        break_time_sec: int = 5 * 60,
    ):
        """
        Adds mandatory breaks for each vehicle:
        - Break every `work_time_sec` of driving
        - Each break lasts `break_time_sec`
        - Earliest break start is half of `work_time_sec`
        """
        logger.info(
            f"Adding break constraints: {break_time_sec // 60} min break every {work_time_sec // 3600} hrs"
        )

        try:
            time_dimension = routing.GetDimensionOrDie("Time")
            solver = routing.solver()
            num_nodes = routing.Size()

            # Use actual service durations from the site list
            node_visit_transits = []
            for routing_index in range(num_nodes):
                node_idx = manager.IndexToNode(routing_index)
                try:
                    service_time = self.solver._get_service_duration(node_idx)
                except IndexError:
                    service_time = 0
                node_visit_transits.append(service_time)

            for vehicle_idx, vehicle in enumerate(self.solver.vehicles):
                vehicle_id = vehicle.id
                max_route_time = self.solver.max_route_seconds.get(vehicle_id, 12 * 3600)

                logger.debug(f"Vehicle {vehicle_id} max route time: {max_route_time} seconds")

                breaks = []
                next_break_start = work_time_sec // 2  # Start after half of work period

                while next_break_start + break_time_sec < max_route_time:
                    break_var = solver.FixedDurationIntervalVar(
                        next_break_start,
                        work_time_sec,
                        break_time_sec,
                        False,
                        f"Break_V{vehicle_idx}_T{next_break_start}",
                    )
                    breaks.append(break_var)
                    logger.debug(
                        f"Added break for vehicle {vehicle_idx} at {next_break_start}s lasting {break_time_sec}s"
                    )

                    # Move to next break slot
                    next_break_start += work_time_sec + break_time_sec

                time_dimension.SetBreakIntervalsOfVehicle(breaks, vehicle_idx, node_visit_transits)
                logger.debug(f"Set {len(breaks)} breaks for vehicle {vehicle_idx}")

            logger.info("Break constraints successfully applied to all vehicles")

        except Exception as e:
            logger.error(f"Failed to add break constraints: {e}", exc_info=True)
            raise

    def _add_co2_dimension(self, routing, manager):
        """Add a CO₂ emissions dimension (grams) with per-vehicle rates matching manual formula."""
        logger.info("Adding CO₂ emissions dimension")

        try:
            # One transit callback per vehicle (so each can have its own rate)
            co2_callback_indices: List[int] = []

            for vehicle_idx, vehicle in enumerate(self.solver.vehicles):
                rate = _vehicle_emission_rate_g_per_m(vehicle)

                def make_co2_callback(rate_g_per_m: float):
                    def co2_callback(from_idx, to_idx):
                        from_node = manager.IndexToNode(from_idx)
                        to_node = manager.IndexToNode(to_idx)
                        dist_m = self.solver.distance_matrix[from_node][to_node]  # meters
                        return int(max(0.0, dist_m) * rate_g_per_m)  # grams
                    return co2_callback

                cb_index = routing.RegisterTransitCallback(make_co2_callback(rate))
                co2_callback_indices.append(cb_index)
                logger.debug(f"Vehicle {vehicle_idx} CO₂ callback registered: rate={rate} g/m")

            # Per-vehicle CO₂ caps (grams)
            vehicle_co2_limits = [
                int(getattr(v, "max_co2_grams", 10_000_000)) for v in self.solver.vehicles
            ]
            logger.debug(f"Vehicle CO₂ limits: {vehicle_co2_limits}")

            # IMPORTANT: Use per-vehicle transits so each vehicle gets its own evaluator
            routing.AddDimensionWithVehicleTransits(
                co2_callback_indices,
                0,                      # no slack
                10_000_000,     # capacity per vehicle (grams)
                True,                   # start cumul at 0
                "CO2",
            )

            logger.info("CO₂ dimension added (units: grams)")

        except Exception as e:
            logger.error(f"Failed to add CO₂ dimension: {str(e)}", exc_info=True)
            raise
