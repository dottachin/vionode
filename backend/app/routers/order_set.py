from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_rodb_session
from app.models.order_set import OrderSet
from app.models.order import Order

from app.schemas.order_set import OrderSetOut, OrderSetCreate, OrderSetUpdate

router = APIRouter()

@router.post("/order-sets", response_model=OrderSetOut)
def save_order_set(data: OrderSetCreate, db: Session = Depends(get_rodb_session)):
    order_set = OrderSet(name=data.name)  # ID auto
    db.add(order_set)
    db.flush()  # ensures order_set.id is available

    for order_data in data.orders:
        db.add(Order(**order_data.dict(), order_set_id=order_set.id))

    db.commit()
    db.refresh(order_set)
    return order_set

@router.get("/order-sets", response_model=List[OrderSetOut])
def fetch_order_sets(db: Session = Depends(get_rodb_session)):
    return db.query(OrderSet).all()

@router.get("/order-sets/{id}", response_model=OrderSetOut)
def load_order_set(id: int, db: Session = Depends(get_rodb_session)):
    result = db.query(OrderSet).filter_by(id=id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Order set not found")
    return result

# ✏️ Update (rename and/or replace orders)
@router.put("/order-sets/{id}", response_model=OrderSetOut)
def update_order_set(id: int, data: OrderSetUpdate, db: Session = Depends(get_rodb_session)):
    order_set = db.query(OrderSet).filter_by(id=id).first()
    if not order_set:
        raise HTTPException(status_code=404, detail="Order set not found")

    if data.name is not None:
        order_set.name = data.name

    if data.orders is not None:
        # Replace all orders for this set
        db.query(Order).filter_by(order_set_id=id).delete()
        for order_data in data.orders:
            db.add(Order(**order_data.dict(), order_set_id=id))

    db.commit()
    db.refresh(order_set)
    return order_set

# 🗑️ Delete
@router.delete("/order-sets/{id}", status_code=204)
def delete_order_set(id: int, db: Session = Depends(get_rodb_session)):
    order_set = db.query(OrderSet).filter_by(id=id).first()
    if not order_set:
        raise HTTPException(status_code=404, detail="Order set not found")

    # Remove children first (if not using cascade)
    db.query(Order).filter_by(order_set_id=id).delete()
    db.delete(order_set)
    db.commit()
