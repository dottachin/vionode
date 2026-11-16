from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.site import Site
from app.schemas.site import SiteOut, SiteCreate, SiteUpdate

router = APIRouter()


@router.get("/sites", response_model=List[SiteOut])
def fetch_sites(
    db: Session = Depends(get_db)
):
    return db.query(Site).all()

@router.post("/sites", response_model=SiteOut)
def create_site(site: SiteCreate, db: Session = Depends(get_db)):
    db_site = Site(**site.dict())
    db.add(db_site)
    db.commit()
    db.refresh(db_site)
    return db_site

@router.put("/sites/{id}", response_model=SiteOut)
def update_site(id: str, updates: SiteUpdate, db: Session = Depends(get_db)):
    site = db.query(Site).filter_by(id=id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    for key, value in updates.dict(exclude_unset=True).items():
        setattr(site, key, value)
    db.commit()
    db.refresh(site)
    return site

@router.delete("/sites/{id}")
def delete_site(id: str, db: Session = Depends(get_db)):
    site = db.query(Site).filter_by(id=id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    db.delete(site)
    db.commit()
    return {"detail": "Deleted"}
