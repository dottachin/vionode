# Vionode backend — automatic Alembic migrations

This backend now runs Alembic migrations automatically when the FastAPI app starts.

Key points:

- On startup the app calls the new helper in `app.db.migrator` which runs `alembic upgrade head` against the configured DB URL (from `DATABASE_URL`).
- We still keep `Base.metadata.create_all` as a safety fallback for any models not covered by migrations.

Manual usage

- Run the server (development, with auto-reload):

```bash
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- Run migrations manually (from project root):

```bash
# using alembic cli
alembic upgrade head

# OR programmatically by invoking the new runner module from python
python -c "from app.db.migrator import run_alembic_migrations; import os; run_alembic_migrations(db_url=os.getenv('DATABASE_URL'))"
```

Notes

- The migrations runner reads `alembic.ini` in the project root and will override `sqlalchemy.url` with the configured `DATABASE_URL` when provided.
- Make sure your environment variables are configured (e.g., `.env`) so the app can find the database URL on startup.
