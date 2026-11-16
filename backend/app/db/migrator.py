import os
import logging
from typing import Optional

from alembic.config import Config
from alembic import command

logger = logging.getLogger(__name__)


def run_alembic_migrations(alembic_ini_path: Optional[str] = None, db_url: Optional[str] = None) -> None:
    """Programmatically run alembic migrations (upgrade to head).

    alembic_ini_path: optional explicit path to the alembic.ini file. If not
    provided the function will try to resolve it from the project root.

    db_url: if provided this will override the sqlalchemy.url setting in the
    alembic config so migrations run against the desired database.
    """
    # Resolve a sane default for alembic.ini (project root / alembic.ini)
    if not alembic_ini_path:
        # app/db -> app -> project root
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        alembic_ini_path = os.path.join(project_root, "alembic.ini")

    if not os.path.exists(alembic_ini_path):
        raise FileNotFoundError(f"alembic.ini not found at {alembic_ini_path}")

    cfg = Config(alembic_ini_path)
    if db_url:
        cfg.set_main_option("sqlalchemy.url", db_url)

    logger.info("Running Alembic migrations (upgrade head) using %s", alembic_ini_path)
    # Upgrade to head (apply all available migrations)
    command.upgrade(cfg, "head")
