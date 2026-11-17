<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo.svg" alt="Vionode" width="420">
  </picture>
</p>

<p align="center">
  <img alt="License: All rights reserved" src="https://img.shields.io/badge/license-All%20rights%20reserved-red">
  <img alt="Status: Portfolio - view only" src="https://img.shields.io/badge/status-portfolio%20%C2%B7%20view%20only-0f172a">
</p>

> [!IMPORTANT]
> **This is proprietary software, shown for portfolio purposes only.**
> You may view the code, but you may not copy, run, modify, distribute or sell any part of it without written permission. See [LICENSE](LICENSE).

# Vionode

**Vionode** is a vehicle routing and fleet optimization platform. You describe your fleet (vehicles and drivers), your locations (depots, clients, suppliers…) and the work to be done (orders or milk-run stops). Vionode then calculates efficient routes that respect real-world constraints such as vehicle capacity, opening hours, driver working time, special equipment and hazardous goods. It can minimise **distance**, **driving time** or **CO₂ emissions**.

Real road distances and travel times come from the **HERE Matrix Routing API**. The routing itself is solved with **Google OR-Tools**.

---

## Table of contents

1. [How it works (big picture)](#how-it-works-big-picture)
2. [Services](#services)
3. [Repository layout](#repository-layout)
4. [Features in detail](#features-in-detail)
5. [Prerequisites](#prerequisites)
6. [Configuration (environment variables)](#configuration-environment-variables)
7. [Quick start with Docker](#quick-start-with-docker)
8. [Creating the first user](#creating-the-first-user)
9. [Local development (without Docker)](#local-development-without-docker)
10. [Database & migrations](#database--migrations)
11. [API overview](#api-overview)
12. [How the solver works](#how-the-solver-works)
13. [Production deployment (Traefik)](#production-deployment-traefik)
14. [Testing](#testing)
15. [Troubleshooting](#troubleshooting)
16. [License](#license)

---

## How it works (big picture)

```
            ┌──────────────────────────┐
  Browser → │  frontend (React + Vite) │
            └────────────┬─────────────┘
                         │ JWT-authenticated HTTP
           ┌─────────────┴──────────────┐
           ▼                            ▼
 ┌───────────────────┐        ┌────────────────────┐        ┌──────────────┐
 │ backend (FastAPI) │        │ solver (FastAPI +  │ ─────▶ │ HERE Matrix  │
 │ CRUD + auth       │        │ OR-Tools VRP)      │        │ Routing API  │
 └─────────┬─────────┘        └────────────────────┘        └──────────────┘
           ▼                     (stateless; caches
 ┌───────────────────┐            matrices on disk)
 │ PostgreSQL 17     │
 └───────────────────┘
```

1. The user signs in. The **backend** checks the credentials and returns a JWT.
2. Using the UI, the user manages **vehicles, drivers, sites, order sets and milk runs**. The backend stores all of these in **PostgreSQL**.
3. When the user starts an optimization, the **frontend** builds a routing request from that data and sends it to the **solver**.
4. The solver gets distance and duration matrices from **HERE** (results are cached), builds a Vehicle Routing Problem (VRP), solves it with OR-Tools and returns routes plus metrics.
5. The frontend shows the routes on a map. It can save the result through the backend (`/optimizations`, `/global-optimizations`) so you can view it again or compare it with other results later.

The solver is **stateless**: it does not connect to the database. The backend never calls the solver; the frontend is what connects the two.

---

## Services

| Service    | Stack                                   | Role                                             | Host port (compose)    |
|------------|-----------------------------------------|--------------------------------------------------|------------------------|
| `frontend` | React 19 + TypeScript + Vite, served by nginx | Web UI: data management, maps, results     | `127.0.0.1:5173` → 80  |
| `backend`  | FastAPI + SQLAlchemy 2 + Alembic        | REST API, authentication, data persistence       | `127.0.0.1:3333` → 8000 |
| `solver`   | FastAPI + Google OR-Tools 9.14          | Route optimization engine                        | `127.0.0.1:8080` → 8000 |
| `db`       | PostgreSQL 17 (alpine)                  | Persistent storage (`pg_data` volume)            | not exposed            |

All ports are bound to `127.0.0.1`, so they can only be reached from the machine running Docker.

---

## Repository layout

```
vionode/
├── docker-compose.yml        # Local stack: frontend, backend, solver, db
├── .env.example              # Deployment-level variables (Traefik / ACME / domain)
├── db_init/
│   └── 00-restore.sh         # Optional DB seeding from db_init/db.dump on first start
├── traefik/                  # Reverse-proxy config for production (TLS, /api & /solver routing)
│
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI app, router registration, startup migrations
│   │   ├── database.py       # SQLAlchemy engine / session (reads DATABASE_URL)
│   │   ├── core/security.py  # Password hashing (bcrypt) + JWT creation/validation
│   │   ├── deps/auth.py      # `get_current_user` / `require_roles` dependencies
│   │   ├── db/migrator.py    # Runs `alembic upgrade head` programmatically
│   │   ├── models/           # SQLAlchemy ORM models (one file per entity)
│   │   ├── schemas/          # Pydantic request/response models
│   │   └── routers/          # HTTP endpoints (one file per resource)
│   ├── alembic/              # Migration environment + versions/
│   └── alembic.ini
│
├── solver/
│   ├── main.py               # FastAPI app entry point
│   ├── route_optimizer/
│   │   ├── api/router.py     # /optimization/* endpoints and the optimization pipeline
│   │   ├── models/schemas.py # Input models: Site, Vehicle, Driver, Order, RoutingRequest
│   │   ├── logic/matching.py # Matches orders to vehicles that can carry them
│   │   ├── logic/virtualizer.py # Single-depot "virtual site" transformation
│   │   ├── logic/matrix.py   # HERE Matrix API client with memory + disk cache
│   │   ├── solver/vrp_solver.py   # OR-Tools model construction and solve
│   │   ├── solver/constraints.py  # Capacity, time, distance, pickup/delivery, CO₂
│   │   ├── solver/callbacks.py    # Transit callbacks used by OR-Tools
│   │   ├── solver/results.py      # Turns the OR-Tools solution into JSON routes
│   │   └── utils/formatting.py
│   ├── scripts/show_sample_results.py
│   └── tests/test_multi_depot_solver.py
│
└── frontend/
    ├── src/
    │   ├── App.tsx           # Routes (see "Features in detail")
    │   ├── api/              # Axios clients for backend and solver
    │   ├── pages/            # Top-level screens
    │   ├── components/       # fleet/, orders/, sites/, optimizer/, auth/, ui/
    │   ├── types/            # Shared TypeScript types
    │   └── utils/            # Builds solver input from UI data
    ├── nginx.conf            # SPA serving config used in the Docker image
    └── .env.example / .env.production
```

---

## Features in detail

| UI page (route)                      | What you can do |
|--------------------------------------|-----------------|
| **Login** (`/login`)                 | Sign in with a username and password. Your JWT is valid for 10 hours. If your session expires you are sent back to the login page. |
| **Dashboard** (`/`)                  | Landing page and overview. |
| **Fleet manager** (`/fleet`)         | Add, edit and delete **vehicles** (type, capacity in kg and m², dimensions, equipment, fuel type and consumption, costs, home depot) and **drivers** (licence, daily/weekly driving and service hour limits). |
| **Sites** (`/sites`)                 | Manage locations with coordinates, category (`depot`, `client`, `supplier`, `warehouse`, `hub`, `workshop`, `subcontractor`, `recycling`, `repair`), opening hours and service time. |
| **Orders** (`/orders`)               | Group orders into **order sets**. Each order has a source and destination site, pallets/floor space, weight, time windows, priority (1–3), required equipment and hazardous material classes. |
| **Milk run** (`/milk-run`)           | Plan recurring loops that visit a list of stops without payload constraints, and show them on a map. |
| **Global optimization** (`/optimization-global`) | Run multi-depot optimizations across the whole network and save the results. |
| **Compare** (`/compare`)             | Put saved optimizations side by side (distance, duration, CO₂, vehicles used), for example to compare an optimized plan with a manual one. |

**Constraints the solver respects**

- **Capacity**: both weight (kg) and floor surface/pallets per vehicle.
- **Time windows**: site opening hours, order time windows, service time at each stop, and a configurable slack/waiting time.
- **Driver hours**: the longest allowed route per vehicle comes from its assigned drivers' daily limits.
- **Max route distance** for each vehicle.
- **Vehicle–order compatibility**: required equipment (for example a refrigeration unit or a hazardous-material container) and floor space.
- **Pickup & delivery pairing**: an order is picked up and delivered by the same vehicle, pickup first.
- **Multi-depot**: each vehicle starts and ends at its own `depot_id`.
- **Fixed costs**: optional per-vehicle or per-route costs, which push the solver to use fewer vehicles.

**Optimization objective** (`optimization_arc`): `distance`, `duration` or `co2`. CO₂ is calculated as fuel consumption × an emission factor for the fuel type. The factors are defined in `solver/route_optimizer/solver/constraints.py` (for example, Road diesel B7 = 3.10 kg CO₂e/L).

---

## Prerequisites

- **Docker** and **Docker Compose v2** for the containerized setup.
- A **HERE API key** with access to the *Matrix Routing v8* API. The frontend uses it for map tiles and the solver uses it for matrices. You can get one at <https://developer.here.com>.
- For local development without Docker:
  - **Python 3.11**
  - **Node.js 20** and npm
  - **PostgreSQL 17** (or the `db` container on its own)

---

## Configuration (environment variables)

Every service reads its own `.env` file. Each one has a committed `*.example` template. Real `.env` files are git-ignored, so never commit secrets.

### `backend/.env`

| Variable       | Example                                                        | Description |
|----------------|----------------------------------------------------------------|-------------|
| `DATABASE_URL` | `postgresql+psycopg://postgres:postgres@localhost:5432/vionode` | SQLAlchemy URL. **Required**: the app won't start without it. In Docker Compose it is overridden to point at the `db` service. |
| `JWT_SECRET`   | `a-long-random-string`                                         | Key used to sign JWTs. **Change it** from the default `change_me`. One way to generate one: `openssl rand -hex 32`. |
| `POSTGRES_*`   | `vionode` / `postgres` / `postgres`                            | Database name and credentials (they must match the `db` service). |

### `solver/.env`

| Variable           | Description |
|--------------------|-------------|
| `HERE_API_KEY`     | **Required.** The solver can't compute matrices without it. |
| `GUNICORN_WORKERS` | Number of worker processes (compose sets it to `2`). |

### `frontend/.env.local` (development) / `.env.production` (build)

| Variable              | Dev value                 | Prod value | Description |
|-----------------------|---------------------------|------------|-------------|
| `VITE_API_BASE`       | `http://localhost:3333`   | `/api`     | Base URL of the backend. |
| `VITE_SOLVER_BASE`    | `http://localhost:8080`   | `/solver`  | Base URL of the solver. |
| `VITE_HERE_API_KEY`   | your key                  | your key   | Used for HERE map tiles and to decode route polylines. |
| `VITE_SURFACE_SCALE_FACTOR`, `VITE_WEIGHT_SCALE_FACTOR` | `100` | `100` | Optional. Scale factors used when the UI converts capacities and demands to the integers OR-Tools needs. |

> Vite embeds `VITE_*` variables into the JavaScript bundle **at build time**. If you change them, rebuild the frontend. Also remember that anything in `VITE_*` can be seen by every user of the site.

### Root `.env` (deployment only)

| Variable      | Description |
|---------------|-------------|
| `ACME_EMAIL`  | Email address for Let's Encrypt certificate registration (Traefik). |
| `DOMAIN_ROOT` | Public domain the stack is served on. |

---

## Quick start with Docker

```bash
# 1. Create env files from the templates
cp backend/.env.example  backend/.env
cp solver/.env.example   solver/.env
cp frontend/.env.example frontend/.env.local

# 2. Edit them: set HERE_API_KEY (solver + frontend) and JWT_SECRET (backend)

# 3. (Optional) seed the database: drop a dump at db_init/db.dump

# 4. Build and start everything
docker compose up --build -d

# 5. Follow the logs
docker compose logs -f backend solver
```

When the stack is running:

| What                         | URL |
|------------------------------|-----|
| Backend API docs (Swagger)   | <http://localhost:3333/docs> |
| Solver API docs (Swagger)    | <http://localhost:8080/docs> |
| Solver health check          | <http://localhost:8080/> → `{"message": "Vionode Solver API is running."}` |
| Frontend                     | <http://localhost:5173> (see note below) |

> **Note about the frontend container:** the Docker image is built with `.env.production`, so it sends requests to the relative paths `/api` and `/solver`. The bundled nginx only serves static files and **does not proxy** these paths, because in production Traefik does that routing (see [Production deployment](#production-deployment-traefik)). For local work, either run the frontend in dev mode (`npm run dev`, see below), which talks to `localhost:3333` / `localhost:8080` directly, or put a reverse proxy in front.

### Seeding the database

On the **first** start of an empty `pg_data` volume, Postgres runs `db_init/00-restore.sh`:

- If `db_init/db.dump` exists, it is restored. The script detects whether it is a custom-format dump (`pg_restore`) or plain SQL (`psql`).
- Otherwise the database starts empty, and the backend creates the schema through migrations.

To re-seed, remove the volume and start again. **This deletes all data:**

```bash
docker compose down -v && docker compose up -d
```

---

## Creating the first user

There is no sign-up endpoint, so you have to create users directly in the database. The quickest way is to use the backend container:

```bash
docker compose exec backend python - <<'PY'
from app.database import SessionLocal
from app.models.auth import User, Role
from app.core.security import hash_password

db = SessionLocal()
admin = db.get(Role, "admin") or Role(name="admin")
user = User(username="admin", password_hash=hash_password("change-me-now"), roles=[admin])
db.add(user)
db.commit()
print("Created user", user.username)
PY
```

You can then sign in at `/login` as `admin` / `change-me-now`. Usernames are stored and compared **in lower case**.

---

## Local development (without Docker)

Run each service in its own terminal. Starting just the database with Docker is the easiest option:

```bash
docker compose up -d db
# db isn't published to the host by default. For local dev, add this under the db service:
#   ports: ["127.0.0.1:5432:5432"]
```

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # DATABASE_URL should point to localhost:5432
uvicorn app.main:app --reload --host 127.0.0.1 --port 3333
```

Migrations run automatically on startup. See [backend/README.md](backend/README.md) for details.

### Solver

```bash
cd solver
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # set HERE_API_KEY
uvicorn main:app --reload --host 127.0.0.1 --port 8080
```

Logs are written to `solver/logs/optimization.log`. HERE matrix responses are cached in `solver/here_matrix_cache/` for 30 days. Delete that folder to force fresh results.

### Frontend

```bash
cd frontend
cp .env.example .env.local    # VITE_API_BASE=http://localhost:3333, VITE_SOLVER_BASE=http://localhost:8080
npm ci --legacy-peer-deps     # --legacy-peer-deps is needed (tailwind-variants 2.x + rizzui)
npm run dev                   # http://localhost:5173
```

Other scripts: `npm run build` (type-check and production build), `npm run lint`, `npm run preview`.

---

## Database & migrations

- The schema is managed by **Alembic** (`backend/alembic/versions/`). The initial migration `0001_initial_schema.py` creates these tables: `users`, `roles`, `user_roles`, `drivers`, `vehicles`, `sites`, `order_sets`, `orders`, `milk_runs`, `milk_run_sites`, `optimizations` and `global_optimizations`.
- When the backend starts, it runs `alembic upgrade head` and then `Base.metadata.create_all()` as a safety net.
- To create a new migration after you change a model:

  ```bash
  cd backend
  alembic revision --autogenerate -m "describe your change"
  alembic upgrade head
  ```

  Check the generated file before you commit it, because autogenerate can miss renames and type changes.

---

## API overview

The full interactive documentation is at `/docs` on each service. In summary:

### Backend (`:3333`)

Every endpoint except `/auth/login` needs an `Authorization: Bearer <token>` header.

| Method(s)                     | Path                                   | Purpose |
|-------------------------------|----------------------------------------|---------|
| `POST`                        | `/auth/login`                          | `{username, password}` → `{access_token}` |
| `GET POST PUT DELETE`         | `/drivers`, `/drivers/{id}`            | Drivers CRUD |
| `GET POST PUT DELETE`         | `/vehicles`, `/vehicles/{id}`          | Vehicles CRUD |
| `GET POST PUT DELETE`         | `/sites`, `/sites/{id}`                | Sites CRUD |
| `GET POST PUT DELETE`         | `/order-sets`, `/order-sets/{id}`      | Order sets and their orders |
| `GET POST PUT DELETE`         | `/milk-runs`, `/milk-runs/{id}`        | Milk-run definitions |
| `GET POST PATCH DELETE`       | `/optimizations`, `/optimizations/{id}` | Saved optimization results |
| `GET POST PATCH DELETE`       | `/global-optimizations`, `/global-optimizations/{id}` | Saved multi-depot results |

Example:

```bash
TOKEN=$(curl -s -X POST localhost:3333/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me-now"}' | jq -r .access_token)

curl -H "Authorization: Bearer $TOKEN" localhost:3333/vehicles
```

### Solver (`:8080`)

| Method | Path                               | Purpose |
|--------|------------------------------------|---------|
| `POST` | `/optimization/routes`             | Default mode: pickup and delivery of orders from one depot, or from depots detected in the orders. |
| `POST` | `/optimization/routes/milk-runs`   | Milk-run mode: orders are treated as stops with zero weight and surface. |
| `POST` | `/optimization/routes/multi-depot` | Forces multi-depot modelling. Vehicles are tied to `depot_id`, and site-level demands (`sites[].demand_weight/demand_surface`) are supported without orders. |
| `POST` | `/optimization/manual-stats`       | **No optimization.** Calculates distance, time and CO₂ for the sequence you provide, so you can compare a manual plan with an optimized one. |

The main fields of the request body (`RoutingRequest`):

```jsonc
{
  "vehicles": [ { "id": "V1", "type": "van", "weight": 1200, "surface": 8, "length": 4, "height": 2,
                  "fuel_type": "Road diesel - B7", "fuel_consumption": 0.09,
                  "driver_ids": ["D1"], "depot_id": "DEPOT1", "equipment": [] } ],
  "drivers":  [ { "id": "D1", "name": "Alice", "license_number": "ABC12345",
                  "max_daily_driving_hours": 9, "max_daily_service_hours": 10 } ],
  "orders":   [ { "order_id": "O1", "floor": 2, "weight": 300, "priority": 1,
                  "source": { /* Site */ }, "destination": { /* Site */ } } ],
  "depots": [ /* optional Site[] */ ],
  "sites":  [ /* optional Site[] for multi-depot site-demand mode */ ],
  "optimization_arc": "distance",   // distance | duration | co2
  "solver_mode": "fast",            // fast | balanced | optimal
  "slack_time_seconds": 3600,
  "fixed_cost_per_route": null
}
```

A `Site` contains `id` (letters, digits, `_` and `-` only), `name`, `address`, `coordinates {latitude, longitude}`, `category`, and optionally `operational_hours {start, end}` and `service_time` (in seconds; default 30 min, or 0 for virtual depots).

The response contains `result` (routes, stops, metrics), `steps` (a status for each stage of the pipeline, useful for debugging) and `metadata`. Distances, durations and CO₂ are returned in several units (`*_m`/`*_km`, `*_s`/`*_h`/`hh:mm`, `*_g`/`*_kg`) so the UI doesn't have to convert them.

---

## How the solver works

For each request, `solver/route_optimizer/api/router.py` runs these steps in order:

1. **Validation.** Pydantic checks the input: coordinates are in range, time windows are ordered, there is at least one vehicle, and every vehicle's drivers exist.
2. **Solver mode.** The mode sets the search strategy and time budget:

   | Mode       | First solution strategy        | Metaheuristic         | Time limit |
   |------------|--------------------------------|-----------------------|------------|
   | `fast`     | Local cheapest insertion       | Guided local search   | 20 s       |
   | `balanced` | Parallel cheapest insertion    | Guided local search   | 120 s      |
   | `optimal`  | Parallel cheapest insertion    | Guided local search   | 300 s      |

3. **Vehicle–order matching** (`logic/matching.py`). For each order, the solver works out which vehicles have the required equipment and enough floor space.
4. **Depot detection.** Depots come from `depots`, or from order sites in the `depot` category, or else from the first order's source. If there is more than one depot (or the multi-depot endpoint is used), the solver switches to multi-depot mode.
5. **Virtualization** (`logic/virtualizer.py`, single-depot only). Sites visited by several orders are split into *virtual sites*, so OR-Tools can visit each node exactly once. The original sites are put back after solving.
6. **Matrices** (`logic/matrix.py`). The solver requests truck-aware distance and duration matrices from HERE. Requests are retried with exponential backoff, and responses are cached in memory and on disk (keyed on coordinates and truck parameters).
7. **Route time limits.** The maximum route duration for each vehicle is calculated from its drivers' hour limits.
8. **Solve** (`solver/vrp_solver.py` + `constraints.py`). The solver builds the OR-Tools routing model, adds all the constraint dimensions and runs the search.
9. **Post-processing** (`solver/results.py`). Virtual sites are reverted, units are normalized and the JSON response is returned.

> OR-Tools is pinned to `9.14.6206` because 9.15 breaks `RoutingModel.SetAllowedVehiclesForIndex`. Don't upgrade it without testing.

---

## Production deployment (Traefik)

The `traefik/` folder holds the reverse-proxy configuration used in production:

- `traefik.yml`: HTTP (`:80`) and HTTPS (`:443`) entry points, the Docker provider (containers are **not** exposed unless they are labelled) and automatic **Let's Encrypt** certificates via HTTP challenge (`ACME_EMAIL`).
- `dynamic.yml`: shared middlewares:
  - `gzip` compression
  - `security-headers`: HSTS, nosniff, frame deny, referrer and permissions policy
  - `strip-api` / `strip-solver`: remove the `/api` and `/solver` prefixes, so `https://<domain>/api/vehicles` reaches the backend's `/vehicles`.

A typical setup on a single host serves everything from `DOMAIN_ROOT`:

| Public path          | Routed to  |
|----------------------|------------|
| `https://<domain>/`        | `frontend` |
| `https://<domain>/api/*`   | `backend` (prefix stripped) |
| `https://<domain>/solver/*`| `solver` (prefix stripped)  |

The base `docker-compose.yml` does **not** include Traefik. Add a `traefik` service, the routers and labels in a production override file (for example `docker-compose.prod.yml`).

**Before you go to production, check that:**

- `JWT_SECRET` is a strong random value.
- The Postgres password is not the default `postgres`.
- CORS (`allow_origins=["*"]` in `backend/app/main.py` and `solver/main.py`) is restricted to your domain.
- The solver is only reachable through the proxy. Its gunicorn timeout is very long (6000 s) to allow `optimal` runs.

---

## Testing

```bash
cd solver
pip install pytest
python -m pytest -v
```

`tests/test_multi_depot_solver.py` checks single-depot routing and multi-depot vehicle assignment, including the case of an unused vehicle. To print example solver output, run `scripts/show_sample_results.py`.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---------|----------------------|
| Backend exits with `Missing DATABASE_URL` | `backend/.env` is missing or `DATABASE_URL` isn't set. |
| Solver returns 500 with `HERE_API_KEY environment variable not set` | Set `HERE_API_KEY` in `solver/.env` and restart the solver. |
| Every request returns `401 Invalid or expired token` | The token is older than 10 hours, or `JWT_SECRET` changed since it was issued. Sign in again. |
| Frontend loads but API calls return 404 or HTML | The production build is calling `/api` with no proxy in front. Use `npm run dev` locally, or deploy behind Traefik. |
| Solver returns 400 | Input validation failed. The `detail` field explains why (for example a bad site id or `end` before `start` in a time window). |
| Some orders are missing from the routes | No vehicle has the required equipment or capacity, or the time windows can't be met. Check `steps.vehicle_matching.unmatched_orders` in the response. |
| Optimizations take too long | Use `solver_mode: "fast"`, or reduce the problem size. Repeating the same sites is quicker because of the matrix cache. |
| `npm ci` fails with peer-dependency errors | Add `--legacy-peer-deps`. |
| `db.dump` was not restored | The restore script only runs on an **empty** volume. Run `docker compose down -v` (this deletes all data) and start again. |

---

## License

**Copyright © 2026 dottachin. All rights reserved.**

Vionode is proprietary software. The source code is public **only so it can be viewed** as part of a portfolio. It is **not** open source.

Without prior written permission, you may not:

- copy or download the code, in whole or in part
- use, run, deploy or host it
- modify it or build derivative works from it
- distribute, sublicense or sell it
- use it to train AI models or to build competing products

The name "Vionode" and its logo are also not licensed for use. Read the full terms in [LICENSE](LICENSE).

For licensing or purchase inquiries, contact me through [my GitHub profile](https://github.com/dottachin).
