from route_optimizer.logging_config import get_logger
from time import perf_counter
from typing import Dict, List
from route_optimizer.models.schemas import Order, SolverResult

logger = get_logger(__name__)


class ResultProcessor:
    def __init__(self, solver):
        logger.info("Initializing ResultProcessor")
        self.solver = solver
        logger.debug(f"ResultProcessor initialized with solver: {solver}")

    def prepare_results(
        self, solution, routing, manager, start_time: float
    ) -> SolverResult:
        """Prepare final results from the optimization solution."""
        logger.info("Preparing final results from solution")
        logger.debug(f"Solution: {solution}, Routing: {routing}, Manager: {manager}")

        try:
            routes = []
            time_dim = routing.GetDimensionOrDie("Time")
            surface_dim = routing.GetDimensionOrDie("Surface")
            weight_dim = routing.GetDimensionOrDie("Weight")
            distance_dim = routing.GetDimensionOrDie("Distance")
            co2_dim = routing.GetDimensionOrDie("CO2")

            logger.debug("Retrieved routing dimensions successfully")

            for v_idx, vehicle in enumerate(self.solver.vehicles):
                logger.debug(
                    f"Processing vehicle {v_idx + 1}/{len(self.solver.vehicles)}: {vehicle.id_vehicule}"
                )

                index = routing.Start(v_idx)
                route = {
                    "vehicle_id": vehicle.id_vehicule,
                    "driver_ids": vehicle.driver_ids,
                    "depot_id": getattr(vehicle, "depot_id", None),
                    "stops": [],
                    "customer_stops": [],
                    "total_distance": 0,
                    "total_duration": solution.Value(
                        time_dim.CumulVar(routing.End(v_idx))
                    )
                    - solution.Value(time_dim.CumulVar(routing.Start(v_idx))),
                    "total_surface": 0,
                    "total_weight": 0,
                    "total_co2_emissions": 0,
                    "used": False,
                }
                logger.debug(
                    f"Initialized route structure for vehicle {vehicle.id_vehicule}"
                )

                stop_count = 0
                visited_physical_sites = set()
                while True:
                    node = manager.IndexToNode(index)
                    site = self.solver.sites[node]
                    site_id = site.id

                    if hasattr(site, "metadata"):
                        physical_site_id = site.metadata.get(
                            "original_site_id", site_id
                        )
                    else:
                        physical_site_id = site.id
                    # Determine whether to apply service time
                    if physical_site_id in visited_physical_sites:
                        service_time = 0
                    else:
                        service_time = self.solver._get_service_duration(node) or 0
                        visited_physical_sites.add(physical_site_id)

                    arrival_time = solution.Value(time_dim.CumulVar(index))
                    departure_time = arrival_time + service_time
                    stop_type = "depot" if node in self.solver.depot_indices else "site"

                    stop_data = {
                        "site_id": site_id,
                        "type": stop_type,
                        "arrival_time": arrival_time,
                        "service_time": service_time,
                        "departure_time": departure_time,
                        "surface": solution.Value(surface_dim.CumulVar(index)),
                        "weight": solution.Value(weight_dim.CumulVar(index)),
                        "distance_to_next": 0,
                        "co2_to_next": 0,
                    }

                    logger.debug(f"Added stop {stop_count + 1}: {stop_data}")

                    if routing.IsEnd(index):
                        route["stops"].append(stop_data)
                        if stop_type == "site":
                            route["customer_stops"].append(stop_data)
                        break

                    next_index = solution.Value(routing.NextVar(index))
                    current_distance = solution.Value(distance_dim.CumulVar(index))
                    next_distance = solution.Value(distance_dim.CumulVar(next_index))
                    delta_distance = max(0, next_distance - current_distance)

                    route["total_distance"] += delta_distance
                    stop_data["distance_to_next"] = delta_distance

                    current_co2 = solution.Value(co2_dim.CumulVar(index))
                    next_co2 = solution.Value(co2_dim.CumulVar(next_index))
                    delta_co2 = max(0, next_co2 - current_co2)

                    route["total_co2_emissions"] += delta_co2
                    stop_data["co2_to_next"] = delta_co2

                    route["stops"].append(stop_data)
                    if stop_type == "site":
                        route["customer_stops"].append(stop_data)
                    index = next_index
                    stop_count += 1

                if route["stops"]:
                    route["total_surface"] = max(
                        stop["surface"] for stop in route["stops"]
                    )
                    route["total_weight"] = max(
                        stop["weight"] for stop in route["stops"]
                    )
                    logger.debug(
                        f"Calculated max surface: {route['total_surface']}, max weight: {route['total_weight']}"
                    )
                route["used"] = len(route["customer_stops"]) > 0

                routes.append(route)
                logger.info(
                    f"Completed route for vehicle {vehicle.id_vehicule} with {stop_count} stops"
                )

            solve_time = perf_counter() - start_time
            logger.info(f"Solution processed in {solve_time:.2f} seconds")

            metrics = self._calculate_metrics(routes, solve_time)
            logger.debug(f"Calculated metrics: {metrics}")

            unassigned = self.solver.get_unassigned_orders_details()
            logger.debug(f"Unassigned orders: {len(unassigned)}")

            return SolverResult(
                status="success",
                routes=routes,
                metrics=metrics,
                unassigned_orders=unassigned,
            )

        except Exception as e:
            logger.error(f"Failed to prepare results: {str(e)}", exc_info=True)
            return SolverResult(
                status="error",
                routes=[],
                metrics={"error": str(e)},
                unassigned_orders=[],
            )

    def _calculate_metrics(
        self, routes: List[Dict], solve_time: float
    ) -> Dict[str, float]:
        """Calculate performance metrics from the solution."""
        logger.debug("Calculating solution metrics")

        try:
            total_distance = sum(r["total_distance"] for r in routes)
            logger.debug(f"Total distance across all routes: {total_distance}")

            surface_utilization = self._calculate_utilization(routes, "surface")
            weight_utilization = self._calculate_utilization(routes, "weight")
            logger.debug(
                f"Surface utilization: {surface_utilization:.2%}, Weight utilization: {weight_utilization:.2%}"
            )
            total_co2 = sum(r["total_co2_emissions"]/1000 for r in routes)
            avg_co2_per_km = total_co2 / total_distance if total_distance > 0 else 0

            number_of_vehicles = sum(1 for route in routes if route.get("used"))
            metrics = {
                "solve_time": solve_time,
                "total_distance": total_distance,
                "total_vehicles_used": number_of_vehicles,
                "unassigned_orders": len(self.solver.unassigned_orders),
                "surface_utilization": surface_utilization,
                "weight_utilization": weight_utilization,
                "total_co2_emissions_kg": total_co2,
                "avg_co2_per_km_kg": avg_co2_per_km }

            return metrics
        except Exception as e:
            logger.error(f"Failed to calculate metrics: {str(e)}", exc_info=True)
            return {"error": str(e)}

    def _calculate_utilization(self, routes: List[Dict], capacity_type: str) -> float:
        """Calculate average utilization for a given capacity type."""
        logger.debug(f"Calculating {capacity_type} utilization")

        if not routes:
            logger.debug("No routes provided, returning 0 utilization")
            return 0.0

        total_utilization = 0.0
        for route in routes:
            try:
                vehicle = next(
                    v
                    for v in self.solver.vehicles
                    if v.id_vehicule == route["vehicle_id"]
                )
                logger.debug(f"Processing vehicle {vehicle.id_vehicule}")

                if capacity_type == "surface":
                    capacity = vehicle.surface * self.solver.max_vehicle_utilization
                    used = route["total_surface"]
                else:
                    capacity = self.solver.vehicle_weight_capacities[
                        vehicle.id_vehicule
                    ]
                    used = route["total_weight"]

                utilization = used / capacity if capacity > 0 else 0
                total_utilization += utilization
                logger.debug(
                    f"Vehicle {vehicle.id_vehicule} {capacity_type} utilization: {utilization:.2%}"
                )

            except Exception as e:
                logger.error(
                    f"Error calculating utilization for route {route['vehicle_id']}: {str(e)}"
                )
                continue

        avg_utilization = total_utilization / len(routes)
        logger.debug(f"Average {capacity_type} utilization: {avg_utilization:.2%}")
        return avg_utilization

    def extract_assignments(self, solution, routing, manager) -> Dict:
        """Extract detailed assignment information from the solution."""
        logger.info("Extracting detailed assignment information")

        if not solution:
            logger.warning("No solution provided, returning empty result")
            return {"status": "no_solution"}

        try:
            assignments = {
                "vehicle_assignments": {},
                "unassigned_orders": [],
            }
            surface_dim = routing.GetDimensionOrDie("Surface")
            weight_dim = routing.GetDimensionOrDie("Weight")
            print(f"Surface dim: {surface_dim}")
            print(f"Weight dim: {weight_dim}")
            logger.debug("Retrieved routing dimensions for assignment extraction")
            print(f"Raw Solution:{solution}")
            for v_idx, vehicle in enumerate(self.solver.vehicles):
                logger.debug(
                    f"Processing assignments for vehicle {v_idx + 1}/{len(self.solver.vehicles)}: {vehicle.id_vehicule}"
                )

                index = routing.Start(v_idx)
                order_ids = set()
                max_surface = 0
                max_weight = 0

                while not routing.IsEnd(index):
                    surface = solution.Value(surface_dim.CumulVar(index))
                    weight = solution.Value(weight_dim.CumulVar(index))
                    max_surface = max(max_surface, surface)
                    max_weight = max(max_weight, weight)

                    for order in self.solver.orders:
                        if any(
                            u["order_id"] == order.order_id
                            for u in self.solver.unassigned_orders
                        ):
                            continue

                        pickup_idx = manager.NodeToIndex(
                            self.solver.site_id_to_index[order.source.id]
                        )
                        assigned_vehicle = solution.Value(
                            routing.VehicleVar(pickup_idx)
                        )

                        if assigned_vehicle == v_idx:
                            order_ids.add(order.order_id)
                            logger.debug(
                                f"Order {order.order_id} assigned to vehicle {vehicle.id_vehicule}"
                            )

                    index = solution.Value(routing.NextVar(index))

                if order_ids:
                    assignments["vehicle_assignments"][vehicle.id_vehicule] = {
                        "assigned_orders": sorted(order_ids),
                        "surface_used": max_surface,
                        "surface_capacity": int(
                            vehicle.surface * self.solver.max_vehicle_utilization
                        ),
                        "weight_used": max_weight,
                        "weight_capacity": int(
                            self.solver.vehicle_weight_capacities[vehicle.id_vehicule]
                        ),
                    }
                    logger.info(
                        f"Vehicle {vehicle.id_vehicule} assigned {len(order_ids)} orders"
                    )

            # Add unassigned orders with reasons
            unassigned_details = []
            for order in self.solver.orders:
                if any(
                    u["order_id"] == order.order_id
                    for u in self.solver.unassigned_orders
                ):
                    reason = self._get_incompatibility_reason(order)
                    unassigned_details.append(
                        {
                            "order_id": order.order_id,
                            "reason": reason,
                        }
                    )
                    logger.debug(f"Order {order.order_id} unassigned: {reason}")

            assignments["unassigned_orders"] = unassigned_details
            logger.info(
                f"Extracted assignments for {len(assignments['vehicle_assignments'])} vehicles\
                      and {len(unassigned_details)} unassigned orders"
            )

            return assignments

        except Exception as e:
            logger.error(f"Failed to extract assignments: {str(e)}", exc_info=True)
            return {"status": "error", "message": str(e)}

    def _get_incompatibility_reason(self, order: Order) -> str:
        """Get detailed reason why an order couldn't be assigned."""
        logger.debug(f"Determining incompatibility reason for order {order.order_id}")

        reasons = []
        logger.debug(
            f"Order requirements: utilities={order.required_utilities}, floor={order.floor}, weight={order.weight},\
                  hazardous={order.hazardous_types}"
        )

        # Check equipment requirements
        missing_equipment = [
            req
            for req in order.required_utilities
            if not any(req in v.equipements for v in self.solver.vehicles)
        ]
        if missing_equipment:
            reasons.append(f"missing equipment: {', '.join(missing_equipment)}")
            logger.debug(f"Missing equipment: {missing_equipment}")

        # Check surface capacity
        max_surface = max(
            v.surface * self.solver.max_vehicle_utilization
            for v in self.solver.vehicles
        )
        if order.floor > max_surface:
            reasons.append(
                f"needs {order.floor} surface units (max available {max_surface})"
            )
            logger.debug(
                f"Insufficient surface capacity: {order.floor} > {max_surface}"
            )

        # Check weight capacity
        max_weight = max(self.solver.vehicle_weight_capacities.values())
        if (order.weight or 0) > max_weight:
            reasons.append(
                f"needs {order.weight} weight units (max available {max_weight})"
            )
            logger.debug(f"Insufficient weight capacity: {order.weight} > {max_weight}")

        # Check hazardous materials
        if (
            order.hazardous_types
            and not reasons
            and not any(
                "Contenants pour matières dangereuses" in v.equipements
                for v in self.solver.vehicles
            )
        ):
            reasons.append("no hazardous material containers available")
            logger.debug("No hazardous material containers available")

        final_reason = "; ".join(reasons) if reasons else "unknown reason"
        logger.debug(f"Final incompatibility reason: {final_reason}")
        return final_reason
