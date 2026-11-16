from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_rodb_session
from app.models.site import Site
from app.schemas.site import SiteOut, SiteCreate, SiteUpdate

router = APIRouter()

import os
import json
import requests
from typing import List, Dict, Tuple
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import timedelta

from app.database import get_rodb_session
from app.models.site import Site as RODBSite
from app.schemas.site import SiteOut, SiteCreate

router = APIRouter()
HERE_API_KEY = os.getenv("HERE_API_KEY")


def timedelta_to_hhmm(td: timedelta) -> str:
    total_seconds = int(td.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    return f"{hours:02d}:{minutes:02d}"


# 🌍 Geocoding using HERE API
def geocode_address(address: str) -> Tuple[float, float]:
    response = requests.get(
        "https://geocode.search.hereapi.com/v1/geocode",
        params={
            "q": address,
            "apiKey": HERE_API_KEY,
            "limit": 1
        }
    )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Geocoding failed")
    
    items = response.json().get("items", [])
    if not items:
        raise HTTPException(status_code=404, detail=f"Could not geolocate: {address}")
    
    pos = items[0]["position"]
    return pos["lat"], pos["lng"]


# 🔁 Transform Tetris row to SiteCreate
def transform_tetris_site(row: Dict) -> SiteCreate:
    location = row.get("location")
    if isinstance(location, str):
        try:
            location = json.loads(location)
        except json.JSONDecodeError:
            location = {}
    elif not isinstance(location, dict):
        location = {}

    lat = location.get("lat")
    lng = location.get("lng")
    if lat is None or lng is None:
        lat, lng = geocode_address(row["address"])

    return SiteCreate(
        id=str(row["id"]),
        name=row["name"],
        address=row["address"],
        category=row.get("category") or "Unknown",
        coordinates={"latitude": lat, "longitude": lng},
        service_time=900,
        operational_hours={"start": "08:00", "end":timedelta_to_hhmm( row.get("closing_hour")) or "15:00"}
    )


# 📥 GET /sites with fallback to Tetris
@router.get("/sites", response_model=List[SiteOut])
def fetch_sites(
    rodb: Session = Depends(get_rodb_session)
):
    return rodb.query(RODBSite).all()

@router.post("/sites", response_model=SiteOut)
def create_site(site: SiteCreate, db: Session = Depends(get_rodb_session)):
    db_site = Site(**site.dict())
    db.add(db_site)
    db.commit()
    db.refresh(db_site)
    return db_site

@router.put("/sites/{id}", response_model=SiteOut)
def update_site(id: str, updates: SiteUpdate, db: Session = Depends(get_rodb_session)):
    site = db.query(Site).filter_by(id=id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    for key, value in updates.dict(exclude_unset=True).items():
        setattr(site, key, value)
    db.commit()
    db.refresh(site)
    return site

@router.delete("/sites/{id}")
def delete_site(id: str, db: Session = Depends(get_rodb_session)):
    site = db.query(Site).filter_by(id=id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    db.delete(site)
    db.commit()
    return {"detail": "Deleted"}
