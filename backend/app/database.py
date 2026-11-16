import os
from typing import Generator

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

load_dotenv()

RODB_DATABASE_URL = os.getenv("RODB_DATABASE_URL")
if not RODB_DATABASE_URL:
    raise ValueError("Missing RODB_DATABASE_URL environment variable")

rodb_engine = create_engine(RODB_DATABASE_URL)
RODBSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=rodb_engine)


def get_rodb_session() -> Generator[Session, None, None]:
    db = RODBSessionLocal()
    try:
        yield db
    finally:
        db.close()
