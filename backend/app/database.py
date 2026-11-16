import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from dotenv import load_dotenv
from typing import Generator

# Load environment variables from .env file
load_dotenv()

# --- DATABASE URLS ---
RODB_DATABASE_URL = os.getenv("RODB_DATABASE_URL")
# TETRIS_DATABASE_URL = os.getenv("TETRIS_DATABASE_URL")

if not RODB_DATABASE_URL :
    raise ValueError("Missing RODB or TETRIS database URLs in environment variables")

# --- ENGINES ---
rodb_engine = create_engine(RODB_DATABASE_URL)
# tetris_engine = create_engine(TETRIS_DATABASE_URL)

# --- SESSION FACTORIES ---
RODBSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=rodb_engine)
# TetrisSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=tetris_engine)

# --- DEPENDENCIES ---
def get_rodb_session() -> Generator[Session, None, None]:
    db = RODBSessionLocal()
    try:
        yield db
    finally:
        db.close()

# def get_tetris_session() -> Generator[Session, None, None]:
#     db = TetrisSessionLocal()
#     try:
#         yield db
#     finally:
#         db.close()
