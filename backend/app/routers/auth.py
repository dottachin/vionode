# app/routers/auth.py
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_rodb_session
from app.models.auth import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.core.security import verify_password, make_access_token

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_rodb_session)):
    username = body.username.lower().strip()
    user = db.query(User).where(User.username == username).first()
    if not user or not verify_password(body.password, user.password_hash) or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad credentials")

    roles = [r.name for r in user.roles]
    token = make_access_token(sub=user.id, roles=roles, extra={"username": user.username})
    return TokenResponse(access_token=token)