from fastapi import Depends, FastAPI
from app.database import rodb_engine, RODB_DATABASE_URL
from app.deps.auth import get_current_user
from app.models.base import Base
import app.models 
# Routers
from app.routers.driver import router as driver_router
from app.routers.vehicle import router as vehicle_router
from app.routers.site import router as site_router
from app.routers.order_set import router as order_set_router
from app.routers.milk_run import router as milk_run_router
from app.routers.optimizations import router as opt
from app.routers.global_optimizations import router as global_opt_router
from app.routers.auth import router as auth
from fastapi.middleware.cors import CORSMiddleware

# NOTE: Instead of creating tables at import time we run Alembic migrations on
# startup and keep create_all as a last-resort fallback for any missing models.

app = FastAPI(title="Logistics API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # your Vite frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Register routers
app.include_router(auth, prefix="", tags=["Auth"])
app.include_router(driver_router, prefix="", tags=["Drivers"], dependencies=[Depends(get_current_user)])
app.include_router(vehicle_router, prefix="", tags=["Vehicles"], dependencies=[Depends(get_current_user)])
app.include_router(site_router, prefix="", tags=["Sites"], dependencies=[Depends(get_current_user)])
app.include_router(order_set_router, prefix="", tags=["Order Sets"], dependencies=[Depends(get_current_user)])
app.include_router(milk_run_router, prefix="", tags=["Milk Runs"], dependencies=[Depends(get_current_user)])
app.include_router(opt, prefix="", tags=["Optimizations"], dependencies=[Depends(get_current_user)])
app.include_router(global_opt_router, prefix="", tags=["Global Optimizations"], dependencies=[Depends(get_current_user)])


# --- DB migration / startup hooks ---
from app.db.migrator import run_alembic_migrations


@app.on_event("startup")
async def _run_startup_migrations() -> None:
    """Run Alembic migrations at startup so the DB is brought up-to-date.

    This reads the DB URL from app.database.RODB_DATABASE_URL and sets that on
    the alembic config so migrations target the same DB.
    """
    try:
        run_alembic_migrations(db_url=RODB_DATABASE_URL)
    except Exception as exc:  # pragma: no cover - runtime safety / logging
        # If migrations fail we log but continue — create_all is a safety net.
        print(f"Failed to run alembic migrations: {exc}")

    # Fallback: ensure models that might not be covered by migrations are created
    # (this mirrors the previous behavior which created tables on import).
    try:
        Base.metadata.create_all(bind=rodb_engine)
    except Exception as exc:  # pragma: no cover - runtime safety / logging
        print(f"Failed to create fallback tables via SQLAlchemy: {exc}")

