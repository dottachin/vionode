"""
Run the same sample scenarios as tests/test_multi_depot_solver and print
both the inputs and the solver outputs for quick inspection.
"""

from datetime import time
from typing import List

import numpy as np

from route_optimizer.models.schemas import (
    Coordinates,
    Driver,
    Order,
    Site,
    SiteCategoryEnum,
    TimeWindow,
    Vehicule,
    VehiculeTypeEnum,
)
from route_optimizer.solver.vrp_solver import VRPSolver


def _build_driver(driver_id: str) -> Driver:
    return Driver(
        id=driver_id,
        name=f"Driver {driver_id}",
        license_number=f"LIC-{driver_id}",
        max_daily_driving_hours=10,
        max_daily_service_hours=12,
    )


def _build_vehicle(vehicle_id: str, depot_id: str, driver_id: str) -> Vehicule:
    return Vehicule(
        id_vehicule=vehicle_id,
        weight=10,
        surface=10,
        length=2,
        height=2,
        equipements=[],
        type=VehiculeTypeEnum.PORTEUR,
        carburant="Gazole routier - B7",
        conso=1,
        driver_ids=[driver_id],
        max_distance_meters=1_000_000,
        depot_id=depot_id,
        fixed_cost=100,
    )


def _build_site(site_id: str, category: SiteCategoryEnum, service_time: int = 0) -> Site:
    return Site(
        id=site_id,
        name=site_id,
        address="addr",
        coordinates=Coordinates(latitude=0.0, longitude=0.0),
        category=category,
        service_time=service_time,
        operational_hours=TimeWindow(start=time(0, 0), end=time(23, 59)),
    )


def _print_routes(result) -> None:
    print("\n=== Routes ===")
    for route in result.routes:
        print(
            f"- vehicle={route['vehicle_id']} used={route['used']} depot={route.get('depot_id')}"
            f" dist={route['total_distance']} duration={route['total_duration']}"
            f" surface_max={route['total_surface']} weight_max={route['total_weight']}"
        )
        for stop in route["stops"]:
            print(
                f"    stop site={stop['site_id']} type={stop['type']} "
                f"arr={stop['arrival_time']} dep={stop['departure_time']} "
                f"surface={stop['surface']} weight={stop['weight']} "
                f"dist_to_next={stop['distance_to_next']} co2_to_next={stop['co2_to_next']}"
            )
    if result.unassigned_orders:
        print("\nUnassigned orders:")
        for u in result.unassigned_orders:
            print(f"  - {u}")
    else:
        print("\nUnassigned orders: none")


def _print_inputs(
    title: str,
    sites: List[Site],
    vehicles: List[Vehicule],
    drivers: List[Driver],
    orders: List[Order],
    duration_matrix: np.ndarray,
) -> None:
    print(f"\n=== {title} Inputs ===")
    print(f"Sites ({len(sites)}): {[s.id for s in sites]}")
    print(f"Depots: {[s.id for s in sites if s.category == SiteCategoryEnum.DEPOT]}")
    print(f"Vehicles: {[v.id_vehicule for v in vehicles]}")
    print(f"Drivers: {[d.id for d in drivers]}")
    print(f"Orders: {[o.order_id for o in orders] or '[]'}")
    print(f"Duration matrix shape: {duration_matrix.shape}")


def run_single_depot_case():
    depot = _build_site("D1", SiteCategoryEnum.DEPOT)
    c1 = _build_site("C1", SiteCategoryEnum.CLIENT)
    c2 = _build_site("C2", SiteCategoryEnum.CLIENT)

    order1 = Order(
        order_id="o1",
        floor=1,
        weight=1,
        source=depot,
        destination=c1,
        required_utilities=[],
        hazardous_types=[],
        priority=1,
    )
    order2 = Order(
        order_id="o2",
        floor=1,
        weight=1,
        source=depot,
        destination=c2,
        required_utilities=[],
        hazardous_types=[],
        priority=1,
    )

    duration_matrix = np.array(
        [
            [0, 10, 20],
            [10, 0, 10],
            [20, 10, 0],
        ]
    )
    distance_matrix = duration_matrix.copy()

    driver = _build_driver("driver-1")
    vehicle = _build_vehicle("veh-1", depot.id, driver.id)

    _print_inputs(
        "Single-depot",
        sites=[depot, c1, c2],
        vehicles=[vehicle],
        drivers=[driver],
        orders=[order1, order2],
        duration_matrix=duration_matrix,
    )

    solver = VRPSolver(
        sites=[depot, c1, c2],
        orders=[order1, order2],
        vehicles=[vehicle],
        drivers=[driver],
        duration_matrix=duration_matrix,
        distance_matrix=distance_matrix,
    )

    result = solver.solve()
    print(f"\nSingle-depot solve status: {result.status}")
    _print_routes(result)


def run_multi_depot_case():
    depot_a = _build_site("DA", SiteCategoryEnum.DEPOT)
    depot_b = _build_site("DB", SiteCategoryEnum.DEPOT)
    c1 = _build_site("C1", SiteCategoryEnum.CLIENT)
    c2 = _build_site("C2", SiteCategoryEnum.CLIENT)

    c1.demand_surface = 1
    c2.demand_surface = 1

    duration_matrix = np.array(
        [
            [0, 50, 10, 10],
            [50, 0, 100, 100],
            [10, 100, 0, 5],
            [10, 100, 5, 0],
        ]
    )
    distance_matrix = duration_matrix.copy()

    driver_a = _build_driver("driver-a")
    driver_b = _build_driver("driver-b")
    vehicle_a = _build_vehicle("veh-a", depot_a.id, driver_a.id)
    vehicle_b = _build_vehicle("veh-b", depot_b.id, driver_b.id)

    _print_inputs(
        "Multi-depot",
        sites=[depot_a, depot_b, c1, c2],
        vehicles=[vehicle_a, vehicle_b],
        drivers=[driver_a, driver_b],
        orders=[],
        duration_matrix=duration_matrix,
    )

    solver = VRPSolver(
        sites=[depot_a, depot_b, c1, c2],
        orders=[],
        vehicles=[vehicle_a, vehicle_b],
        drivers=[driver_a, driver_b],
        duration_matrix=duration_matrix,
        distance_matrix=distance_matrix,
        depots=[depot_a, depot_b],
        fixed_cost_per_route=500,
    )

    result = solver.solve()
    print(f"\nMulti-depot solve status: {result.status}")
    _print_routes(result)


if __name__ == "__main__":
    run_single_depot_case()
    run_multi_depot_case()
