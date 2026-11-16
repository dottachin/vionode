import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Integer, cast, text
from sqlalchemy.orm import Session
from typing import Dict, List

from app.database import get_rodb_session
from app.models.vehicle import Vehicle
from app.models.driver import Driver
from app.schemas.vehicle import VehicleOut, VehicleCreate, VehicleUpdate

router = APIRouter()


@router.get("/vehicles", response_model=List[VehicleOut])
def fetch_vehicles(
    rodb: Session = Depends(get_rodb_session)
):
    vehicles = rodb.query(Vehicle)\
    .order_by(cast(Vehicle.id_vehicule, Integer))\
    .all()

    return vehicles

@router.post("/vehicles", response_model=VehicleOut)
def create_vehicle(vehicle: VehicleCreate, db: Session = Depends(get_rodb_session)):
    # Use ints to query Driver (Driver.id is bigint)
    drivers = db.query(Driver).filter(Driver.id.in_(vehicle.driver_ids or [])).all()

    # Prepare payload and store driver_ids as strings
    payload = vehicle.model_dump()              # .dict() if you’re on Pydantic v1
    payload["driver_ids"] = [str(i) for i in (payload.get("driver_ids") or [])]

    db_vehicle = Vehicle(**payload)
    db.add(db_vehicle)
    db.commit()
    db.refresh(db_vehicle)
    return db_vehicle

@router.put("/vehicles/{id}", response_model=VehicleOut)
def update_vehicle(id: str, updates: VehicleUpdate, db: Session = Depends(get_rodb_session)):
    vehicle = db.query(Vehicle).filter_by(id_vehicule=id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    update_data = updates.model_dump(exclude_unset=True)  # .dict(... ) on v1

    if "driver_ids" in update_data and update_data["driver_ids"] is not None:
        ids_int = update_data["driver_ids"]
        drivers = db.query(Driver).filter(Driver.id.in_(ids_int)).all()
        vehicle.drivers = drivers
        vehicle.driver_ids = [str(i) for i in ids_int]   # persist as strings
        update_data.pop("driver_ids")

    for k, v in update_data.items():
        setattr(vehicle, k, v)

    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.delete("/vehicles/{id}")
def delete_vehicle(id: str, db: Session = Depends(get_rodb_session)):
    vehicle = db.query(Vehicle).filter_by(id_vehicule=id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    db.delete(vehicle)
    db.commit()
    return {"detail": "Deleted"}
