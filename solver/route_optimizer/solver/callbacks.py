from route_optimizer.logging_config import get_logger

logger = get_logger(__name__)


class CallbackManager:
    def __init__(self, solver):
        logger.info("Initializing CallbackManager")
        logger.debug(f"CallbackManager created with solver: {solver}")
        self.solver = solver
        logger.debug("Solver reference stored successfully")

    def transit_callback(self, manager, from_index: int, to_index: int) -> int:
        """Callback for transit time including service time."""
        logger.debug(
            f"transit_callback called with from_index={from_index}, to_index={to_index}"
        )

        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        logger.debug(
            f"Converted indices to nodes - from_node={from_node}, to_node={to_node}"
        )

        service_time = self.solver._get_service_duration(from_node)
        logger.debug(f"Service time for node {from_node}: {service_time}")

        try:
            transit_time = int(self.solver.duration_matrix[from_node][to_node])
            logger.debug(f"Transit time from {from_node} to {to_node}: {transit_time}")

            total_time = transit_time + service_time
            logger.debug(f"Total transit time (transit + service): {total_time}")

            return total_time
        except IndexError as e:
            logger.error(
                f"IndexError in transit_callback - from_node={from_node}, "
                f"to_node={to_node}, matrix size={len(self.solver.duration_matrix)}"
                f"details: {e}"
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error in transit_callback: {str(e)}", exc_info=True
            )
            raise

    def distance_callback(self, manager, from_index: int, to_index: int) -> int:
        """Callback for distance between nodes."""
        logger.debug(
            f"distance_callback called with from_index={from_index}, to_index={to_index}"
        )

        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        logger.debug(
            f"Converted indices to nodes - from_node={from_node}, to_node={to_node}"
        )

        try:
            distance = int(self.solver.distance_matrix[from_node][to_node])
            logger.debug(f"Distance from {from_node} to {to_node}: {distance}")
            return distance
        except IndexError as e:
            logger.error(
                f"IndexError in distance_callback - from_node={from_node}, "
                f"to_node={to_node}, matrix size={len(self.solver.distance_matrix)}"
                f"details: {e}"
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error in distance_callback: {str(e)}", exc_info=True
            )
            raise

    def surface_callback(self, manager, from_index: int) -> int:
        """Callback for surface demand at node."""
        logger.debug(f"surface_callback called with from_index={from_index}")

        node = manager.IndexToNode(from_index)
        logger.debug(f"Converted index to node: {node}")

        try:
            surface_demand = self.solver._node_demands["surface"].get(node, 0)
            logger.debug(f"Surface demand for node {node}: {surface_demand}")
            return surface_demand
        except KeyError as e:
            logger.error(
                f"KeyError in surface_callback - 'surface' not found in node_demands details: {e}"
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error in surface_callback: {str(e)}", exc_info=True
            )
            raise

    def weight_callback(self, manager, from_index: int) -> int:
        """Callback for weight demand at node."""
        logger.debug(f"weight_callback called with from_index={from_index}")

        node = manager.IndexToNode(from_index)
        logger.debug(f"Converted index to node: {node}")

        try:
            weight_demand = self.solver._node_demands["weight"].get(node, 0)
            logger.debug(f"Weight demand for node {node}: {weight_demand}")
            return weight_demand
        except KeyError as e:
            logger.error(
                f"KeyError in weight_callback - 'weight' not found in node_demands details : {e}"
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error in weight_callback: {str(e)}", exc_info=True
            )
            raise
