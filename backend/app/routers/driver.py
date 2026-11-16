from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_rodb_session
from app.models.driver import Driver
from app.schemas.driver import DriverCreate, DriverOut, DriverUpdate

router = APIRouter()

@router.get("/drivers", response_model=List[DriverOut])
def fetch_drivers(db: Session = Depends(get_rodb_session)):
    return db.query(Driver).all()

@router.post("/drivers", response_model=DriverOut)
def create_driver(driver: DriverCreate, db: Session = Depends(get_rodb_session)):
    db_driver = Driver(**driver.model_dump())
    db.add(db_driver)
    db.commit()
    db.refresh(db_driver)
    return db_driver

@router.put("/drivers/{id}", response_model=DriverOut)
def update_driver(id: int, updates: DriverUpdate, db: Session = Depends(get_rodb_session)):
    driver = db.query(Driver).filter_by(id=id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    for key, value in updates.model_dump(exclude_unset=True).items():
        setattr(driver, key, value)
    db.commit()
    db.refresh(driver)
    return driver

@router.delete("/drivers/{id}")
def delete_driver(id: int, db: Session = Depends(get_rodb_session)):
    driver = db.query(Driver).filter_by(id=id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    db.delete(driver)
    db.commit()
    return {"detail": "Deleted"}
