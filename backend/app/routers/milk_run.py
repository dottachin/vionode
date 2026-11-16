from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Dict, Iterable

from app.database import get_rodb_session
from app.models.milk_run import MilkRun
from app.models.site import Site
from app.schemas.milk_run import (
    MilkRunOut, MilkRunCreate, MilkRunUpdate, MilkRunOptimizeInput, OptimizerResult
)

router = APIRouter()

def _dedupe_preserve_order(items: Iterable[str]) -> List[str]:
    seen = set()
    result = []
    for it in items:
        if it not in seen:
            seen.add(it)
            result.append(it)
    return result

def _validate_site_ids(session: Session, site_ids: List[str]) -> List[str]:
    if site_ids is None:
        return []
    norm = [str(s).strip() for s in site_ids if str(s).strip()]
    norm = _dedupe_preserve_order(norm)
    if not norm:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="site_ids must contain at least one valid site id."
        )
    existing = set(
        s.id for s in session.query(Site.id).filter(Site.id.in_(norm)).all()
    )
    missing = [s for s in norm if s not in existing]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "Some site_ids do not exist.", "missing": missing}
        )
    return norm

def _clean_map(d: Dict[str, str] | None) -> Dict[str, str]:
    if not d:
        return {}
    out: Dict[str, str] = {}
    for k, v in d.items():
        ks = str(k).strip()
        vs = str(v).strip()
        if ks and vs:
            out[ks] = vs
    return out

@router.get("/milk-runs", response_model=List[MilkRunOut])
def fetch_milk_runs(rodb: Session = Depends(get_rodb_session)):
    return rodb.query(MilkRun).all()

@router.get("/milk-runs/{milk_run_id}", response_model=MilkRunOut)
def get_milk_run(milk_run_id: str, rodb: Session = Depends(get_rodb_session)):
    mr = rodb.query(MilkRun).get(milk_run_id)
    if not mr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milk run not found.")
    return mr

@router.post("/milk-runs", response_model=MilkRunOut, status_code=status.HTTP_201_CREATED)
def create_milk_run(payload: MilkRunCreate, rodb: Session = Depends(get_rodb_session)):
    site_ids = _validate_site_ids(rodb, payload.site_ids)
    mr = MilkRun(
        name=payload.name,
        site_ids=site_ids,
        depot_id=payload.depot_id,
        vehicle_ids=[s for s in (payload.vehicle_ids or []) if str(s).strip()],
        site_vehicle_map=_clean_map(payload.site_vehicle_map),
    )
    rodb.add(mr)
    try:
        rodb.commit()
    except Exception:
        rodb.rollback()
        raise HTTPException(status_code=500, detail="Failed to create milk run.")
    rodb.refresh(mr)
    return mr

@router.put("/milk-runs/{milk_run_id}", response_model=MilkRunOut)
def update_milk_run(
    milk_run_id: str,
    payload: MilkRunUpdate,
    rodb: Session = Depends(get_rodb_session),
):
    mr = rodb.query(MilkRun).get(milk_run_id)
    if not mr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milk run not found.")

    if payload.name is not None:
        mr.name = payload.name

    if payload.site_ids is not None:
        mr.site_ids = _validate_site_ids(rodb, payload.site_ids)

    if payload.depot_id is not None:
        mr.depot_id = payload.depot_id

    if payload.vehicle_ids is not None:
        mr.vehicle_ids = [str(v).strip() for v in payload.vehicle_ids if str(v).strip()]

    # ✅ NEW: update per-site vehicle map
    if payload.site_vehicle_map is not None:
        mr.site_vehicle_map = _clean_map(payload.site_vehicle_map)

    try:
        rodb.commit()
    except Exception:
        rodb.rollback()
        raise HTTPException(status_code=500, detail="Failed to update milk run.")
    rodb.refresh(mr)
    return mr

@router.delete("/milk-runs/{milk_run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_milk_run(milk_run_id: str, rodb: Session = Depends(get_rodb_session)):
    mr = rodb.query(MilkRun).get(milk_run_id)
    if not mr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milk run not found.")
    rodb.delete(mr)
    try:
        rodb.commit()
    except Exception:
        rodb.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete milk run.")
    return None
