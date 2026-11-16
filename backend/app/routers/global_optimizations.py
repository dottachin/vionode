from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.global_optimization import GlobalOptimization
from app.schemas.global_optimization import (
    GlobalOptimizationCreate,
    GlobalOptimizationRead,
    GlobalOptimizationUpdate,
)

router = APIRouter(prefix="/global-optimizations", tags=["global-optimizations"])


def _clean_ids(values: List[str] | None) -> List[str]:
    if not values:
        return []
    seen = set()
    cleaned: List[str] = []
    for value in values:
        v = str(value).strip()
        if v and v not in seen:
            seen.add(v)
            cleaned.append(v)
    return cleaned


@router.post("", response_model=GlobalOptimizationRead, status_code=status.HTTP_201_CREATED)
def create_global_optimization(
    payload: GlobalOptimizationCreate,
    db: Session = Depends(get_db),
):
    depot_ids = _clean_ids(payload.depot_ids)
    site_ids = _clean_ids(payload.site_ids)
    vehicle_ids = _clean_ids(payload.vehicle_ids)

    if not depot_ids or not site_ids or not vehicle_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="depot_ids, site_ids, and vehicle_ids are required and cannot be empty.",
        )

    if payload.params.slack_time_seconds < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="slack_time_seconds must be greater than or equal to zero.",
        )

    obj = GlobalOptimization(
        name=payload.name,
        depot_ids=depot_ids,
        site_ids=site_ids,
        vehicle_ids=vehicle_ids,
        params=payload.params.model_dump(),
        metrics=(payload.metrics.model_dump() if payload.metrics else None),
        result=(payload.result.model_dump() if payload.result else None),
        solver_run_id=payload.solver_run_id,
        result_id=payload.result_id,
        note=payload.note,
    )
    db.add(obj)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create global optimization.")
    db.refresh(obj)
    return obj


@router.get("", response_model=List[GlobalOptimizationRead])
def list_global_optimizations(
    id: Optional[int] = Query(default=None, ge=1),
    name: Optional[str] = Query(default=None),
    created_from: Optional[datetime] = Query(default=None),
    created_to: Optional[datetime] = Query(default=None),
    solver_run_id: Optional[str] = Query(default=None),
    result_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    stmt = select(GlobalOptimization)

    if id is not None:
        stmt = stmt.where(GlobalOptimization.id == id)
    if name:
        stmt = stmt.where(GlobalOptimization.name == name)
    if solver_run_id:
        stmt = stmt.where(GlobalOptimization.solver_run_id == solver_run_id)
    if result_id:
        stmt = stmt.where(GlobalOptimization.result_id == result_id)
    if created_from:
        stmt = stmt.where(GlobalOptimization.created_at >= created_from)
    if created_to:
        stmt = stmt.where(GlobalOptimization.created_at <= created_to)

    stmt = stmt.order_by(desc(GlobalOptimization.created_at)).limit(limit).offset(offset)
    rows = db.execute(stmt).scalars().all()
    return rows


@router.get("/{global_opt_id}", response_model=GlobalOptimizationRead)
def get_global_optimization(
    global_opt_id: int,
    db: Session = Depends(get_db),
):
    obj = db.get(GlobalOptimization, global_opt_id)
    if not obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Global optimization not found.")
    return obj


@router.patch("/{global_opt_id}", response_model=GlobalOptimizationRead)
def update_global_optimization(
    global_opt_id: int,
    payload: GlobalOptimizationUpdate,
    db: Session = Depends(get_db),
):
    obj = db.get(GlobalOptimization, global_opt_id)
    if not obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Global optimization not found.")

    provided_fields = payload.__pydantic_fields_set__

    if "name" in provided_fields:
        obj.name = payload.name

    if "depot_ids" in provided_fields:
        depot_ids = _clean_ids(payload.depot_ids)
        if not depot_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="depot_ids cannot be empty.",
            )
        obj.depot_ids = depot_ids

    if "site_ids" in provided_fields:
        site_ids = _clean_ids(payload.site_ids)
        if not site_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="site_ids cannot be empty.",
            )
        obj.site_ids = site_ids

    if "vehicle_ids" in provided_fields:
        vehicle_ids = _clean_ids(payload.vehicle_ids)
        if not vehicle_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="vehicle_ids cannot be empty.",
            )
        obj.vehicle_ids = vehicle_ids

    if "params" in provided_fields:
        if payload.params is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="params cannot be null.")
        if payload.params.slack_time_seconds < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="slack_time_seconds must be greater than or equal to zero.",
            )
        obj.params = payload.params.model_dump()

    if "metrics" in provided_fields:
        obj.metrics = payload.metrics.model_dump() if payload.metrics else None

    if "result" in provided_fields:
        obj.result = payload.result.model_dump() if payload.result else None

    if "solver_run_id" in provided_fields:
        obj.solver_run_id = payload.solver_run_id

    if "result_id" in provided_fields:
        obj.result_id = payload.result_id

    if "note" in provided_fields:
        obj.note = payload.note

    db.add(obj)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update global optimization.")
    db.refresh(obj)
    return obj


@router.delete("/{global_opt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_global_optimization(
    global_opt_id: int,
    db: Session = Depends(get_db),
):
    obj = db.get(GlobalOptimization, global_opt_id)
    if not obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Global optimization not found.")
    db.delete(obj)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete global optimization.")
    return None
