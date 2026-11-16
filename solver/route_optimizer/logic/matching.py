from route_optimizer.logging_config import get_logger
from typing import List, Dict, Set
from dataclasses import dataclass
from pydantic import validate_arguments
from route_optimizer.models.schemas import (
    Vehicule,
    Order,
    EquipementEnum,
)

logger = get_logger(__name__)


@dataclass
class CompatibilityResult:
    """Detailed result of vehicle-order compatibility check"""

    is_compatible: bool
    missing_equipment: Set[EquipementEnum]
    hazardous_material_issues: bool
    capacity_violation: bool


class VehicleOrderMatcher:
    def __init__(self, vehicles: List[Vehicule], orders: List[Order]):
        logger.debug("Initializing VehicleOrderMatcher")
        logger.debug(f"Received {len(vehicles)} vehicles and {len(orders)} orders")

        if not vehicles:
            logger.error("No vehicles provided")
            raise ValueError("At least one vehicle must be provided")
        if not orders:
            logger.warning("No orders provided; skipping vehicle-order matching")
            self.vehicles = vehicles
            self.orders = []
            self._skip = True
            return

        self._skip = False
        self.vehicles = vehicles
        self.orders = orders
        self.vehicle_lookup = {v.id_vehicule: v for v in vehicles}

        logger.debug(
            "Vehicle lookup created with IDs: %s", list(self.vehicle_lookup.keys())
        )
        logger.debug("First vehicle sample: %s", vehicles[0] if vehicles else "None")
        logger.debug("First order sample: %s", orders[0] if orders else "None")

    @validate_arguments
    def match(self) -> Dict[str, Dict[str, CompatibilityResult]]:
        """
        Match orders to compatible vehicles with detailed compatibility results.
        """
        if getattr(self, "_skip", False):
            return {}

        logger.debug("Starting vehicle-order matching process")
        results = {}

        for order in self.orders:
            logger.debug(
                "Processing order %s: %s",
                order.order_id,
                {
                    "required_utilities": order.required_utilities,
                    "hazardous_types": order.hazardous_types,
                    "floor": order.floor,
                },
            )

            order_results = {}
            for vehicle in self.vehicles:
                logger.debug(
                    "Checking compatibility with vehicle %s", vehicle.id_vehicule
                )
                result = self._check_compatibility(vehicle, order)
                order_results[vehicle.id_vehicule] = result
                logger.debug(
                    "Compatibility result for order %s with vehicle %s: %s",
                    order.order_id,
                    vehicle.id_vehicule,
                    {
                        "is_compatible": result.is_compatible,
                        "missing_equipment": result.missing_equipment,
                        "hazardous_material_issues": result.hazardous_material_issues,
                        "capacity_violation": result.capacity_violation,
                    },
                )

            results[order.order_id] = order_results
            self._log_compatibility_results(order.order_id, order_results)

        logger.debug("Completed vehicle-order matching")
        logger.debug(
            "Summary of matches: %s",
            {
                order_id: {
                    "compatible_vehicles": len(
                        [v for v in res.values() if v.is_compatible]
                    ),
                    "total_vehicles": len(res),
                }
                for order_id, res in results.items()
            },
        )
        return results

    def get_compatible_vehicles(self, order_id: str) -> List[str]:
        """
        Get list of vehicle IDs that can fulfill the specified order.
        """
        logger.debug("Getting compatible vehicles for order %s", order_id)
        compatible_vehicles = [
            vehicle_id
            for vehicle_id, result in self.match().get(order_id, {}).items()
            if result.is_compatible
        ]
        logger.debug(
            "Found %d compatible vehicles for order %s: %s",
            len(compatible_vehicles),
            order_id,
            compatible_vehicles,
        )
        return compatible_vehicles

    def _check_compatibility(
        self, vehicle: Vehicule, order: Order
    ) -> CompatibilityResult:
        """Perform comprehensive compatibility check between vehicle and order"""
        logger.debug(
            "Checking compatibility between vehicle %s and order %s",
            vehicle.id_vehicule,
            order.order_id,
        )

        # Check equipment requirements
        missing_equipment = {
            req for req in order.required_utilities if req not in vehicle.equipements
        }
        logger.debug(
            "Missing equipment for vehicle %s: %s",
            vehicle.id_vehicule,
            missing_equipment,
        )

        # Check hazardous materials
        hazmat_issues = (
            bool(order.hazardous_types)
            and EquipementEnum.HAZARDOUS_MATERIAL_CONTAINER not in vehicle.equipements
        )
        logger.debug(
            "Hazardous material issues for vehicle %s: %s (order has hazmat: %s)",
            vehicle.id_vehicule,
            hazmat_issues,
            bool(order.hazardous_types),
        )

        # Check capacity (surface in m² vs pallets)
        capacity_violation = order.floor > vehicle.surface
        logger.debug(
            "Capacity violation for vehicle %s: %s (order floor: %s, vehicle surface: %s)",
            vehicle.id_vehicule,
            capacity_violation,
            order.floor,
            vehicle.surface,
        )

        is_compatible = (
            not missing_equipment and not hazmat_issues and not capacity_violation
        )
        logger.debug(
            "Overall compatibility for vehicle %s: %s",
            vehicle.id_vehicule,
            is_compatible,
        )

        return CompatibilityResult(
            is_compatible=is_compatible,
            missing_equipment=missing_equipment,
            hazardous_material_issues=hazmat_issues,
            capacity_violation=capacity_violation,
        )

    def _log_compatibility_results(
        self, order_id: str, results: Dict[str, CompatibilityResult]
    ) -> None:
        """Log compatibility results in a structured way"""
        compatible_vehicles = [vid for vid, res in results.items() if res.is_compatible]
        issues_summary = self._summarize_issues(results)

        if not compatible_vehicles:
            logger.warning(
                "No compatible vehicles found for order %s. Issues: %s",
                order_id,
                issues_summary,
            )
        else:
            logger.info(
                "Order %s has %d compatible vehicles (%s). Issues with others: %s",
                order_id,
                len(compatible_vehicles),
                ", ".join(compatible_vehicles),
                issues_summary,
            )

        logger.debug("Detailed compatibility results for order %s:", order_id)
        for vehicle_id, result in results.items():
            logger.debug(
                "  Vehicle %s: compatible=%s, missing_equip=%s, hazmat=%s, capacity=%s",
                vehicle_id,
                result.is_compatible,
                result.missing_equipment,
                result.hazardous_material_issues,
                result.capacity_violation,
            )

    def _summarize_issues(
        self, results: Dict[str, CompatibilityResult]
    ) -> Dict[str, int]:
        """Summarize compatibility issues across vehicles"""
        issues = {"missing_equipment": 0, "hazardous_material": 0, "capacity": 0}

        for result in results.values():
            if result.missing_equipment:
                issues["missing_equipment"] += 1
            if result.hazardous_material_issues:
                issues["hazardous_material"] += 1
            if result.capacity_violation:
                issues["capacity"] += 1

        logger.debug("Issue summary: %s", issues)
        return issues
