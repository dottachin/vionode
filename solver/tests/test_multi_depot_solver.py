import unittest
from datetime import time

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


class VRPSolverMultiDepotTests(unittest.TestCase):
    def _build_driver(self, driver_id: str) -> Driver:
        return Driver(
            id=driver_id,
            name=f"Driver {driver_id}",
            license_number=f"LIC-{driver_id}",
            max_daily_driving_hours=10,
            max_daily_service_hours=12,
        )

    def _build_vehicle(self, vehicle_id: str, depot_id: str, driver_id: str) -> Vehicule:
        return Vehicule(
            id_vehicule=vehicle_id,
            weight=10,
            surface=10,
            length=2,
            height=2,
            equipements=[],
            type=VehiculeTypeEnum.RIGID_TRUCK,
            carburant="Road diesel - B7",
            conso=1,
            driver_ids=[driver_id],
            max_distance_meters=1_000_000,
            depot_id=depot_id,
            fixed_cost=100,
        )

    def _build_site(
        self, site_id: str, category: SiteCategoryEnum, service_time: int = 0
    ) -> Site:
        return Site(
            id=site_id,
            name=site_id,
            address="addr",
            coordinates=Coordinates(latitude=0.0, longitude=0.0),
            category=category,
            service_time=service_time,
            operational_hours=TimeWindow(start=time(0, 0), end=time(23, 59)),
        )

    def test_single_depot_route_still_works(self):
        depot = self._build_site("D1", SiteCategoryEnum.DEPOT)
        c1 = self._build_site("C1", SiteCategoryEnum.CLIENT)
        c2 = self._build_site("C2", SiteCategoryEnum.CLIENT)

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

        driver = self._build_driver("driver-1")
        vehicle = self._build_vehicle("veh-1", depot.id, driver.id)

        solver = VRPSolver(
            sites=[depot, c1, c2],
            orders=[order1, order2],
            vehicles=[vehicle],
            drivers=[driver],
            duration_matrix=duration_matrix,
            distance_matrix=distance_matrix,
        )

        result = solver.solve()
        self.assertEqual(result.status, "success")
        self.assertEqual(len(result.unassigned_orders), 0)
        self.assertEqual(len(result.routes), 1)
        route = result.routes[0]
        self.assertTrue(route["used"])
        stop_ids = [stop["site_id"] for stop in route["stops"]]
        self.assertEqual(stop_ids[0], depot.id)
        self.assertEqual(stop_ids[-1], depot.id)
        self.assertIn(c1.id, stop_ids)
        self.assertIn(c2.id, stop_ids)

    def test_multi_depot_vehicle_assignment_and_unused_vehicle(self):
        depot_a = self._build_site("DA", SiteCategoryEnum.DEPOT)
        depot_b = self._build_site("DB", SiteCategoryEnum.DEPOT)
        c1 = self._build_site("C1", SiteCategoryEnum.CLIENT)
        c2 = self._build_site("C2", SiteCategoryEnum.CLIENT)

        # Use site-level demands (no pickup/delivery orders)
        c1.demand_surface = 1
        c2.demand_surface = 1

        # Node order matches matrix layout: [DA, DB, C1, C2]
        duration_matrix = np.array(
            [
                [0, 50, 10, 10],
                [50, 0, 100, 100],
                [10, 100, 0, 5],
                [10, 100, 5, 0],
            ]
        )
        distance_matrix = duration_matrix.copy()

        driver_a = self._build_driver("driver-a")
        driver_b = self._build_driver("driver-b")
        vehicle_a = self._build_vehicle("veh-a", depot_a.id, driver_a.id)
        vehicle_b = self._build_vehicle("veh-b", depot_b.id, driver_b.id)

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
        self.assertEqual(result.status, "success")
        routes_by_vehicle = {r["vehicle_id"]: r for r in result.routes}

        served_sites = []
        for route in result.routes:
            served_sites.extend([stop["site_id"] for stop in route["customer_stops"]])

        self.assertCountEqual(served_sites, [c1.id, c2.id])
        self.assertTrue(routes_by_vehicle["veh-a"]["used"])
        self.assertFalse(routes_by_vehicle["veh-b"]["used"])
        self.assertEqual(routes_by_vehicle["veh-a"]["depot_id"], depot_a.id)
        self.assertEqual(routes_by_vehicle["veh-b"]["depot_id"], depot_b.id)


if __name__ == "__main__":
    unittest.main()
