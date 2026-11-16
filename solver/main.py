from fastapi import FastAPI
from route_optimizer.api.router import router as optimization_router
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Vionode Solver API",
    version="1.0.0",
    description="Optimizes vehicle routes with constraints \
        (time windows, driver hours, hazardous goods, etc.)",
)

app.include_router(optimization_router, prefix="")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # your Vite frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Vionode Solver API is running."}
