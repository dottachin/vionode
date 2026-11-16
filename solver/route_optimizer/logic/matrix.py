import httpx
import os
import time
import json
import numpy as np
from typing import List, Tuple
from dotenv import load_dotenv
from route_optimizer.models.schemas import Site, Order, HazardousMaterialEnum
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
)
from prettytable import PrettyTable
from route_optimizer.logging_config import get_logger
from diskcache import Cache
import hashlib
from datetime import timedelta


logger = get_logger(__name__)


class HereMatrixClient:
    BASE_URL = "https://matrix.router.hereapi.com/v8/matrix"
    PER_PAIR_THRESHOLD = 10
    MAX_ATTEMPTS = 5
    INITIAL_SLEEP = 1
    MAX_SLEEP = 30
    REQUEST_TIMEOUT = 30
    MAX_DURATION = 86400
    MAX_DISTANCE = 5000000
    VIRTUAL_SITE_PENALTY_DISTANCE = 0
    VIRTUAL_SITE_PENALTY_DURATION = 0
    CACHE_EXPIRATION = timedelta(days=30)

    def __init__(self, cache_dir: str = "here_matrix_cache"):
        load_dotenv()
        self.api_key = os.getenv("HERE_API_KEY")
        if not self.api_key:
            raise RuntimeError("HERE_API_KEY environment variable not set")

        self.memory_cache = {}
        self.cache = Cache(cache_dir)
        logger.info(
            f"Initialized HERE Matrix Client with disk and memory cache at {cache_dir}"
        )

        self.client = httpx.Client(
            timeout=httpx.Timeout(self.REQUEST_TIMEOUT),
            limits=httpx.Limits(max_connections=10),
            http2=True,
        )

    def _get_cache_key(self, origin: Site, dest: Site, truck_params: dict) -> str:
        key_data = {
            "origin": (origin.coordinates.latitude, origin.coordinates.longitude),
            "dest": (dest.coordinates.latitude, dest.coordinates.longitude),
            "truck_params": truck_params,
        }
        return hashlib.sha256(json.dumps(key_data, sort_keys=True).encode()).hexdigest()

    def _get_matrix_cache_key(self, sites: List[Site], orders: List[Order]) -> str:
        def serialize_site(site: Site):
            return {
                "id": site.id,
                "lat": round(site.coordinates.latitude, 6),
                "lon": round(site.coordinates.longitude, 6),
                "category": site.category.name
                if hasattr(site.category, "name")
                else site.category,
            }

        def serialize_order(order: Order):
            return {
                "id": order.order_id,
                "hazardous": sorted([ht.value for ht in order.hazardous_types]),
            }

        input_data = {
            "sites": [serialize_site(s) for s in sites],
            "orders": [serialize_order(o) for o in orders],
        }
        return hashlib.sha256(
            json.dumps(input_data, sort_keys=True).encode()
        ).hexdigest()

    def _are_same_coordinates(
        self, site1: Site, site2: Site, tol: float = 1e-5
    ) -> bool:
        return (
            abs(site1.coordinates.latitude - site2.coordinates.latitude) < tol
            and abs(site1.coordinates.longitude - site2.coordinates.longitude) < tol
        )

    def compute_matrix(
        self, sites: List[Site], orders: List[Order]
    ) -> Tuple[np.ndarray, np.ndarray]:
        try:
            logger.debug(f"Computing matrix for {len(sites)} sites")
            matrix_cache_key = self._get_matrix_cache_key(sites, orders)

            # Full matrix cache hit - memory
            if matrix_cache_key in self.memory_cache:
                logger.debug("Matrix cache hit (memory)")
                self._log_matrix_as_table(self.memory_cache[matrix_cache_key][0], sites, "Duration Matrix", "seconds")
                self._log_matrix_as_table(self.memory_cache[matrix_cache_key][1], sites, "Distance Matrix", "meters")
                return self.memory_cache[matrix_cache_key]

            # Full matrix cache hit - disk
            if matrix_cache_key in self.cache:
                logger.debug("Matrix cache hit (disk)")
                result = self.cache[matrix_cache_key]
                self._log_matrix_as_table(self.cache[matrix_cache_key][0], sites, "Duration Matrix", "seconds")
                self._log_matrix_as_table(self.cache[matrix_cache_key][1], sites, "Distance Matrix", "meters")
                self.memory_cache[matrix_cache_key] = result
                return result

            durations, distances = self._build_matrix_per_pair(sites, orders)

            durations_np = np.array(durations, dtype=int)
            distances_np = np.array(distances, dtype=int)
            np.fill_diagonal(durations_np, 0)
            np.fill_diagonal(distances_np, 0)

            for i in range(len(sites)):
                for j in range(len(sites)):
                    if i != j and self._are_same_coordinates(sites[i], sites[j]):
                        distances_np[i][j] = self.VIRTUAL_SITE_PENALTY_DISTANCE
                        durations_np[i][j] = self.VIRTUAL_SITE_PENALTY_DURATION
                        logger.debug(f"Penalizing virtual site arc {i} -> {j}")

            self._log_matrix_as_table(durations_np, sites, "Duration Matrix", "seconds")
            self._log_matrix_as_table(distances_np, sites, "Distance Matrix", "meters")

            result = (durations_np, distances_np)
            self.memory_cache[matrix_cache_key] = result
            self.cache.set(
                matrix_cache_key, result, expire=self.CACHE_EXPIRATION.total_seconds()
            )

            return result

        except Exception as e:
            logger.error(f"Matrix computation failed: {str(e)}")
            n = len(sites)
            return (np.zeros((n, n), dtype=int), np.zeros((n, n), dtype=int))

    def _get_truck_parameters(self, orders: List[Order]) -> dict:
        hazardous_goods = {
            ht.value
            for order in orders
            for ht in order.hazardous_types
            if ht
            not in {
                HazardousMaterialEnum.UNSPECIFIED_TYPE,
                HazardousMaterialEnum.UNKNOWN_TYPE,
                HazardousMaterialEnum.ANY_HAZARDOUS,
            }
        }
        params = {"grossWeight": 28000}
        if hazardous_goods:
            params["hazardousGoods"] = list(hazardous_goods)
        return params

    def _build_matrix_per_pair(
        self, sites: List[Site], orders: List[Order]
    ) -> Tuple[List[List[int]], List[List[int]]]:
        n = len(sites)
        durations = [[0] * n for _ in range(n)]
        distances = [[0] * n for _ in range(n)]
        truck_params = self._get_truck_parameters(orders)

        for i in range(n):
            for j in range(n):
                if i == j:
                    continue
                from_cache = False
                try:
                    duration, distance, from_cache = self._get_route_data(
                        sites[i], sites[j], truck_params
                    )
                    durations[i][j] = duration
                    distances[i][j] = distance
                except Exception as e:
                    logger.warning(f"Failed to get route from {i} to {j}: {str(e)}")
                    durations[i][j] = self.MAX_DURATION
                    distances[i][j] = self.MAX_DISTANCE
                    from_cache = False

                # Only rate-limit when we actually hit the API
                if not from_cache:
                    time.sleep(0.2)

        return durations, distances

    @retry(
        stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=5)
    )
    def _get_route_data(
        self, origin: Site, dest: Site, truck_params: dict
    ) -> Tuple[int, int, bool]:
        cache_key = self._get_cache_key(origin, dest, truck_params)

        if cache_key in self.memory_cache:
            logger.debug(f"Memory cache hit for {origin.id} -> {dest.id}")
            result = self.memory_cache[cache_key]
            return result[0], result[1], True

        if cache_key in self.cache:
            logger.debug(f"Disk cache hit for {origin.id} -> {dest.id}")
            result = self.cache[cache_key]
            self.memory_cache[cache_key] = result
            return result[0], result[1], True

        logger.debug(f"Cache miss for {origin.id} -> {dest.id}, calling API")
        url = (
            f"https://router.hereapi.com/v8/routes"
            f"?origin={origin.coordinates.latitude},{origin.coordinates.longitude}"
            f"&destination={dest.coordinates.latitude},{dest.coordinates.longitude}"
            f"&return=summary&transportMode=truck"
            f"&apiKey={self.api_key}"
        )
        for param, value in truck_params.items():
            if isinstance(value, list):
                for item in value:
                    url += f"&truck[{param}]={item}"
            else:
                url += f"&truck[{param}]={value}"

        response = self.client.get(url, timeout=self.REQUEST_TIMEOUT)
        response.raise_for_status()

        data = response.json()
        section = data["routes"][0]["sections"][0]
        result = (
            min(
                section["summary"].get("duration", self.MAX_DURATION), self.MAX_DURATION
            ),
            min(section["summary"].get("length", self.MAX_DISTANCE), self.MAX_DISTANCE),
        )

        self.memory_cache[cache_key] = result
        self.cache.set(cache_key, result, expire=self.CACHE_EXPIRATION.total_seconds())
        return result[0], result[1], False

    def clear_cache(self):
        self.memory_cache.clear()
        self.cache.clear()
        logger.info("Cleared HERE Matrix cache")

    def cache_stats(self) -> dict:
        return {
            "size": self.cache.volume(),
            "count": len(self.cache),
            "disk": self.cache.directory,
        }

    def _log_matrix_as_table(
        self, matrix: np.ndarray, sites: List[Site], title: str, unit: str
    ) -> None:
        site_names = [s.id or f"Site{i}" for i, s in enumerate(sites)]
        table = PrettyTable()
        table.field_names = ["From \\ To"] + site_names
        for i, row in enumerate(matrix):
            row_str = [site_names[i]] + [f"{val}" for val in row]
            table.add_row(row_str)
        logger.info(f"\n{title} ({unit}):\n{table}")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.client.close()
        self.cache.close()
