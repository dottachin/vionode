from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Path, status
from sqlalchemy.orm import Session
from sqlalchemy import select, desc

from app.models.optimization import Optimization
from app.models.milk_run import MilkRun
from app.models.order_set import OrderSet
from app.schemas.optimization import (
    OptimizationCreate,
    OptimizationRead,
    OptimizationUpdate,
)
from app.database import get_rodb_session

router = APIRouter(prefix="/optimizations", tags=["optimizations"])


@router.post("", response_model=OptimizationRead, status_code=status.HTTP_201_CREATED)
def create_optimization(
    payload: OptimizationCreate,
    db: Session = Depends(get_rodb_session),
):
    # Validate references if provided (allow zero or one link)
    if payload.milk_run_id:
        exists = db.scalar(select(MilkRun.id).where(MilkRun.id == payload.milk_run_id))
        if not exists:
            raise HTTPException(status_code=404, detail="MilkRun not found")

    if payload.order_set_id:
        exists = db.scalar(select(OrderSet.id).where(OrderSet.id == payload.order_set_id))
        if not exists:
            raise HTTPException(status_code=404, detail="OrderSet not found")

    obj = Optimization(
        # name support
        name=payload.name,
        milk_run_id=payload.milk_run_id,
        order_set_id=payload.order_set_id,
        depot_id=payload.depot_id,
        site_ids=payload.site_ids,

        # ✅ persist the selected vehicles for this optimization
        vehicle_ids=payload.vehicle_ids or [],

        params=payload.params.model_dump(),
        metrics=payload.metrics.model_dump(),
        result=(payload.result.model_dump() if payload.result else None),
        solver_run_id=payload.solver_run_id,
        result_id=payload.result_id,
        note=payload.note,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("", response_model=List[OptimizationRead])
def list_optimizations(
    milk_run_id: Optional[int] = Query(default=None),
    order_set_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_rodb_session),
):
    stmt = select(Optimization)

    if milk_run_id is not None:
        stmt = stmt.where(Optimization.milk_run_id == milk_run_id)

    if order_set_id is not None:
        stmt = stmt.where(Optimization.order_set_id == order_set_id)

    stmt = stmt.order_by(desc(Optimization.created_at)).limit(limit).offset(offset)
    rows = db.execute(stmt).scalars().all()
    return rows


@router.get("/{opt_id}", response_model=OptimizationRead)
def get_optimization(
    opt_id: int = Path(..., ge=1),
    db: Session = Depends(get_rodb_session),
):
    obj = db.get(Optimization, opt_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Optimization not found")
    return obj


@router.patch("/{opt_id}", response_model=OptimizationRead)
def update_optimization(
    opt_id: int = Path(..., ge=1),
    payload: OptimizationUpdate = ...,
    db: Session = Depends(get_rodb_session),
):
    obj = db.get(Optimization, opt_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Optimization not found")

    # Handle association move (at most one link)
    if payload.milk_run_id is not None or payload.order_set_id is not None:
        if payload.milk_run_id is not None:
            exists = db.scalar(select(MilkRun.id).where(MilkRun.id == payload.milk_run_id))
            if not exists:
                raise HTTPException(status_code=404, detail="MilkRun not found")
            obj.milk_run_id = payload.milk_run_id
            obj.order_set_id = None

        if payload.order_set_id is not None:
            exists = db.scalar(select(OrderSet.id).where(OrderSet.id == payload.order_set_id))
            if not exists:
                raise HTTPException(status_code=404, detail="OrderSet not found")
            obj.order_set_id = payload.order_set_id
            obj.milk_run_id = None

    # Patch simple fields if provided
    if payload.name is not None:
        obj.name = payload.name

    if payload.depot_id is not None:
        obj.depot_id = payload.depot_id

    if payload.site_ids is not None:
        obj.site_ids = payload.site_ids

    # ✅ allow updating vehicles list
    if payload.vehicle_ids is not None:
        obj.vehicle_ids = [str(v).strip() for v in payload.vehicle_ids if str(v).strip()]

    if payload.params is not None:
        obj.params = payload.params.model_dump()

    if payload.metrics is not None:
        obj.metrics = payload.metrics.model_dump()

    if payload.result is not None:
        obj.result = payload.result.model_dump()

    if payload.solver_run_id is not None:
        obj.solver_run_id = payload.solver_run_id

    if payload.result_id is not None:
        obj.result_id = payload.result_id

    if payload.note is not None:
        obj.note = payload.note

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{opt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_optimization(
    opt_id: int = Path(..., ge=1),
    db: Session = Depends(get_rodb_session),
):
    obj = db.get(Optimization, opt_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Optimization not found")
    db.delete(obj)
    db.commit()
    return
