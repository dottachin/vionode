import logging
from logging.handlers import RotatingFileHandler
import os

# Ensure logs directory exists
os.makedirs("logs", exist_ok=True)

# Log file path
log_file_path = "logs/optimization.log"

# Define log format
log_format = (
    "%(asctime)s | %(levelname)-8s | %(name)s | %(funcName)s:%(lineno)d | %(message)s"
)
date_format = "%Y-%m-%d %H:%M:%S"

# Set up root logger configuration
logging.basicConfig(
    level=logging.DEBUG,
    format=log_format,
    datefmt=date_format,
    handlers=[
        RotatingFileHandler(log_file_path, maxBytes=5_000_000, backupCount=3),
        logging.StreamHandler(),
    ],
)

# Silence overly verbose third-party loggers
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("ortools").setLevel(logging.WARNING)
logging.getLogger("route_optimizer.solver.constraints").setLevel(logging.WARNING)
logging.getLogger("route_optimizer.solver.callbacks").setLevel(logging.WARNING)


# Logger getter
def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
