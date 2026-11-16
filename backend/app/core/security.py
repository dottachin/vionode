# app/core/security.py
from datetime import datetime, timedelta, timezone
from typing import Any, Dict
import os, jwt, bcrypt

ALGO = "HS256"
ACCESS_TTL_MIN = 600
ISS = "vionode"
AUD = "vionode-web"
SECRET = os.getenv("JWT_SECRET", "change_me")

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())

def make_access_token(sub: str, roles: list[str], extra: Dict[str, Any] | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": sub, "roles": roles, "iss": ISS, "aud": AUD,
        "iat": int(now.timestamp()), "nbf": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TTL_MIN)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, SECRET, algorithm=ALGO)

def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET, algorithms=[ALGO], audience=AUD, issuer=ISS)
