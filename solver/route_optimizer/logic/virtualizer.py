from typing import List, Optional, Dict, Tuple
from route_optimizer.models.schemas import Order, Site, SiteCategoryEnum
from route_optimizer.logging_config import get_logger

from dataclasses import dataclass
from pydantic import validate_arguments
from collections import defaultdict
from copy import deepcopy

from route_optimizer.solver.vrp_solver import SolverResult


logger = get_logger(__name__)


@dataclass
class VirtualizationResult:
    orders: List[Order]
    site_mapping: Dict[str, List[str]]
    virtual_sites: List[Site]
    order_demands: Dict
    depot: Site


class VirtualSiteGenerator:
    def __init__(self, orders: List[Order]):
        logger.info("Initializing VirtualSiteGenerator")
        logger.debug(f"Received {len(orders)} orders for processing")

        if not orders:
            error_msg = "Orders list cannot be empty"
            logger.error(error_msg)
            raise ValueError(error_msg)

        self.original_orders = orders
        self.first_source_site_id = orders[0].source.id  # <-- capture first source site
        self.depot = orders[0].source
        logger.debug(f"First source site to virtualize: {self.first_source_site_id}")

    @validate_arguments
    def generate(self) -> VirtualizationResult:
        logger.info("Starting virtual site generation process")

        site_mapping: Dict[str, List[str]] = defaultdict(list)
        virtual_sites: List[Site] = []
        updated_orders: List[Order] = []
        order_demands = {}
        instance_counter: int = 0

        site_visit_tracker: Dict[str, Dict[str, int]] = defaultdict(
            lambda: {"source": 0, "destination": 0}
        )

        for i, order in enumerate(self.original_orders):
            source_id = order.source.id
            dest_id = order.destination.id

            # Track visits
            site_visit_tracker[source_id]["source"] += 1
            site_visit_tracker[dest_id]["destination"] += 1

            updated_order = order.model_copy(deep=True)
            order_demands[order.order_id] = {
                "floor": order.floor,
                "weight": order.weight,
            }

            # --- Source Virtualization ---
            if (
                site_visit_tracker[source_id]["source"] > 1
                or site_visit_tracker[source_id]["destination"] > 0
                or (
                    source_id == self.depot.id
                    and order.source.category == SiteCategoryEnum.DEPOT
                )
            ):
                instance_counter += 1
                virtual_site = self._create_virtual_site(
                    original_site=order.source,
                    instance_number=instance_counter,
                    role="source",
                )
                virtual_sites.append(virtual_site)
                updated_order.source = virtual_site
                site_mapping[source_id].append(virtual_site.id)
                logger.info(
                    f"Created virtual source site {virtual_site.id} "
                    f"(original: {source_id}) for order {order.order_id}"
                )

            # --- Destination Virtualization ---
            if (
                dest_id == self.depot.id
                and order.destination.category == SiteCategoryEnum.DEPOT
            ):
                # Always virtualize the depot as destination
                instance_counter += 1
                virtual_site = self._create_virtual_site(
                    original_site=order.destination,
                    instance_number=instance_counter,
                    role="destination",
                )
                virtual_sites.append(virtual_site)
                updated_order.destination = virtual_site
                site_mapping[dest_id].append(virtual_site.id)
                logger.info(
                    f"Forced virtualization of DEPOT as destination → {virtual_site.id} "
                    f"for order {order.order_id}"
                )

            elif (
                site_visit_tracker[dest_id]["destination"] > 1
                or site_visit_tracker[dest_id]["source"] > 0
            ):
                # Virtualize normal sites visited multiple times as destination
                instance_counter += 1
                virtual_site = self._create_virtual_site(
                    original_site=order.destination,
                    instance_number=instance_counter,
                    role="destination",
                )
                virtual_sites.append(virtual_site)
                updated_order.destination = virtual_site
                site_mapping[dest_id].append(virtual_site.id)
                logger.info(
                    f"Created virtual destination site {virtual_site.id} "
                    f"(original: {dest_id}) for order {order.order_id}"
                )

            updated_orders.append(updated_order)

        logger.info(
            f"Virtual site generation complete. Created {len(virtual_sites)} virtual sites "
            f"for {len(site_mapping)} original sites."
        )

        return VirtualizationResult(
            orders=updated_orders,
            site_mapping=dict(site_mapping),
            virtual_sites=virtual_sites,
            order_demands=order_demands,
            depot=self.depot,
        )

    @validate_arguments
    def revert_virtual_sites(self, solution: SolverResult) -> SolverResult:
        logger.info("Starting virtual site reversion process")
        if not solution:
            logger.warning("Received empty solution, returning as-is")
            return solution

        reverted_solution = deepcopy(solution)

        def revert_site_id(site_id: str) -> Tuple[str, bool]:
            if site_id and "_virtual_" in site_id:
                original_id = self.get_original_site_id(site_id)
                return (original_id, True) if original_id else (site_id, False)
            return site_id, False

        for route in reverted_solution.routes:
            for stop in route.get("stops", []):
                virtual_id = stop.get("site_id")
                new_id, was_virtual = revert_site_id(virtual_id)
                if was_virtual:
                    stop["original_virtual_id"] = virtual_id
                    stop["site_id"] = new_id

            for delta in route.get("surface_deltas", []):
                for key in ["from", "to"]:
                    virtual_id = delta.get(key)
                    new_id, was_virtual = revert_site_id(virtual_id)
                    if was_virtual:
                        delta[f"original_virtual_{key}"] = virtual_id
                        delta[key] = new_id

            for delta in route.get("weight_deltas", []):
                for key in ["from", "to"]:
                    virtual_id = delta.get(key)
                    new_id, was_virtual = revert_site_id(virtual_id)
                    if was_virtual:
                        delta[f"original_virtual_{key}"] = virtual_id
                        delta[key] = new_id

        reverted_solution.metrics["virtual_sites_reverted"] = 1.0
        logger.info("Completed virtual site reversion process")
        return reverted_solution

    def _create_virtual_site(
        self, original_site: Site, instance_number: int, role: str
    ) -> Site:
        virtual_id = f"{original_site.id}_virtual_{role}_{instance_number}"
        return Site(
            id=virtual_id,
            name=f"{original_site.name} (Virtual {role} {instance_number})",
            coordinates=original_site.coordinates,
            category=(
                SiteCategoryEnum.VDEPOT
                if original_site.category == SiteCategoryEnum.DEPOT
                else SiteCategoryEnum.VIRTUAL
            ),
            address=original_site.address,
            metadata={
                "original_site_id": original_site.id,
                "virtual_instance": instance_number,
                "is_virtual": True,
                "original_role": role,
            },
        )

    def get_original_site_id(self, virtual_site_id: str) -> Optional[str]:
        parts = virtual_site_id.split("_virtual_")
        return parts[0] if len(parts) > 1 else None
