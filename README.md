# Vionode

Vehicle routing & fleet optimization platform.

| Service    | Stack                              | Port (compose) |
|------------|------------------------------------|----------------|
| `frontend` | React + TypeScript + Vite          | 5173           |
| `backend`  | FastAPI + SQLAlchemy + Alembic     | 3333           |
| `solver`   | FastAPI + Google OR-Tools (VRP)    | 8080           |
| `db`       | PostgreSQL 17                      | —              |

## Features
- Fleet management (vehicles, drivers), sites/depots, orders
- Multi-depot VRP with time windows & capacity constraints
- Milk-run planning and result comparison
- Distance/time matrices and routing via the HERE API

## Quick start
```bash
cp backend/.env.example backend/.env
cp solver/.env.example solver/.env
cp frontend/.env.example frontend/.env.local
# fill in your HERE_API_KEY and JWT_SECRET
docker compose up --build
```

Optionally put a `db.dump` in `db_init/` to seed the database on first start.
