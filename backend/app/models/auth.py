# app/models/user.py
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import List

from sqlalchemy import (
    String, Boolean, DateTime, ForeignKey, Table, Column, UniqueConstraint, Index
)
from sqlalchemy.orm import  Mapped, mapped_column, relationship
from app.models.base import Base

def _utcnow(): return datetime.now(timezone.utc)
def _uuid_str(): return str(uuid.uuid4())



class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", String(50), ForeignKey("roles.name", ondelete="CASCADE"), primary_key=True),
    UniqueConstraint("user_id", "role_id", name="uq_user_role"),
)

class Role(Base):
    __tablename__ = "roles"
    # simple role-by-name; avoids int IDs and extra joins when you just need the name
    name: Mapped[str] = mapped_column(String(50), primary_key=True)
    users: Mapped[List["User"]] = relationship(
        back_populates="roles",
        secondary=user_roles,
        lazy="selectin",
    )

class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    # store emails lower-cased at write time to keep uniqueness portable across DBs
    username: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    roles: Mapped[List[Role]] = relationship(
        back_populates="users",
        secondary=user_roles,
        lazy="joined",
    )

# Helpful indexes (optional)
Index("username_unique", User.username, unique=True)
