"""
AgentTrace FastAPI server.

Exposes four endpoints:
    POST /api/runs          — ingest a complete run payload (run + steps)
    GET  /api/runs          — list runs, newest first (summary fields only)
    GET  /api/runs/{run_id} — full run with ordered steps
    GET  /api/health        — health check

Tables are auto-created on startup. CORS is open for all origins.
"""

import os
import sys
from datetime import datetime
from typing import List, Optional

# ---------------------------------------------------------------------------
# SDK path — make sdk/agenttrace importable regardless of working directory.
# os.path.abspath(__file__) is the canonical path to this file (server/main.py)
# whether the process is started from the repo root, from /app on Railway, or
# anywhere else. We insert the sdk/ directory one level up from server/.
# ---------------------------------------------------------------------------
_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
_SDK_PATH   = os.path.join(_SERVER_DIR, "..", "sdk")
_SDK_PATH   = os.path.normpath(_SDK_PATH)
if _SDK_PATH not in sys.path:
    sys.path.insert(0, _SDK_PATH)

from agenttrace.client import PROMPT_TOKEN_COST_USD, COMPLETION_TOKEN_COST_USD  # noqa: E402

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .db import get_db, init_db
from .models import Run as RunModel, Step as StepModel


# ---------------------------------------------------------------------------
# Application setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AgentTrace",
    description="Open-source observability server for multi-agent AI pipelines.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    """Ensure SQLite tables exist before the first request is handled."""
    init_db()


# ---------------------------------------------------------------------------
# Pydantic request / response schemas
# ---------------------------------------------------------------------------

class StepIn(BaseModel):
    """Schema for a single agent step within the ingest payload."""

    agent_name: str
    seq: int
    input: Optional[str] = None
    output: Optional[str] = None
    error: Optional[str] = None
    latency_ms: float
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    cost_usd: Optional[float] = None
    status: str = "success"


class RunIn(BaseModel):
    """Schema for the full run ingest payload sent by the SDK on exit."""

    id: str
    pipeline_name: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    status: str = "partial"
    steps: List[StepIn] = []


class StepOut(BaseModel):
    """Full step representation returned by GET /api/runs/{run_id}."""

    id: int
    run_id: str
    agent_name: str
    seq: int
    input: Optional[str]
    output: Optional[str]
    error: Optional[str]
    latency_ms: float
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    cost_usd: Optional[float]
    status: str

    class Config:
        from_attributes = True


class RunSummaryOut(BaseModel):
    """Lightweight run representation for the list endpoint."""

    id: str
    pipeline_name: str
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    status: str
    total_cost_usd: Optional[float]
    total_tokens: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class RunDetailOut(RunSummaryOut):
    """Full run representation including all steps."""

    steps: List[StepOut] = []


# ---------------------------------------------------------------------------
# Helper: compute totals from a list of StepIn objects
# ---------------------------------------------------------------------------

def _compute_totals(steps: List[StepIn]) -> tuple[Optional[float], Optional[int]]:
    """
    Server-side validation / recomputation of total cost and total tokens.

    Returns ``(total_cost_usd, total_tokens)``. Both are ``None`` if no step
    carries token information.
    """
    total_cost: float = 0.0
    total_tokens: int = 0
    has_token_data = False

    for step in steps:
        if step.prompt_tokens is not None and step.completion_tokens is not None:
            has_token_data = True
            total_tokens += step.prompt_tokens + step.completion_tokens
        if step.cost_usd is not None:
            total_cost += step.cost_usd

    if not has_token_data:
        return None, None
    return round(total_cost, 10), total_tokens


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["meta"])
def health_check():
    """Simple liveness probe."""
    return {"status": "ok"}


@app.get("/api/config", tags=["meta"])
def get_config():
    """
    Return dashboard-relevant server configuration.

    ``groq_configured`` is True only when GROQ_API_KEY is present in the
    server environment — the key itself is never returned to the client.
    """
    return {
        "prompt_token_cost_usd": PROMPT_TOKEN_COST_USD,
        "completion_token_cost_usd": COMPLETION_TOKEN_COST_USD,
        "db_backend": "sqlite",
        "server_version": "0.1.0",
        "groq_configured": bool(os.environ.get("GROQ_API_KEY")),
    }


@app.post("/api/demo/trigger", tags=["demo"])
def trigger_demo(request: Request):
    """
    Run one demo pipeline synchronously and return the new run_id.

    Uses the incoming request's base URL as the SDK server_url so the demo
    works correctly in both local and production deployments.
    Returns HTTP 503 if GROQ_API_KEY is missing or the run fails to start.
    """
    server_url = str(request.base_url).rstrip("/")
    try:
        from .demo_runner import run_demo  # noqa: PLC0415
        run_id = run_demo(server_url=server_url)
        return {"status": "ok", "run_id": run_id}
    except EnvironmentError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Demo run failed: {exc}")


@app.post("/api/runs", status_code=201, tags=["runs"])
def ingest_run(payload: RunIn, db: Session = Depends(get_db)):
    """
    Ingest a complete run payload from the SDK.

    Idempotent by run ID — if a run with the same ID already exists it is
    silently overwritten (useful for retries after a network blip).

    The server recomputes ``total_cost_usd`` and ``total_tokens`` from the
    provided steps as an independent validation cross-check.
    """
    # Compute server-side totals
    total_cost_usd, total_tokens = _compute_totals(payload.steps)

    # Upsert the run row — delete existing one if present (simple strategy)
    existing = db.get(RunModel, payload.id)
    if existing:
        db.delete(existing)
        db.flush()

    run = RunModel(
        id=payload.id,
        pipeline_name=payload.pipeline_name,
        started_at=payload.started_at,
        ended_at=payload.ended_at,
        status=payload.status,
        total_cost_usd=total_cost_usd,
        total_tokens=total_tokens,
        created_at=datetime.utcnow(),
    )
    db.add(run)

    # Insert all steps
    for step_in in payload.steps:
        step = StepModel(
            run_id=payload.id,
            agent_name=step_in.agent_name,
            seq=step_in.seq,
            input=step_in.input,
            output=step_in.output,
            error=step_in.error,
            latency_ms=step_in.latency_ms,
            prompt_tokens=step_in.prompt_tokens,
            completion_tokens=step_in.completion_tokens,
            cost_usd=step_in.cost_usd,
            status=step_in.status,
        )
        db.add(step)

    db.commit()
    db.refresh(run)
    return {"run_id": run.id, "steps_ingested": len(payload.steps)}


@app.get("/api/runs", response_model=List[RunSummaryOut], tags=["runs"])
def list_runs(
    limit: int = Query(default=50, ge=1, le=500, description="Maximum number of runs to return"),
    db: Session = Depends(get_db),
):
    """
    Return the most recent ``limit`` runs, ordered newest first.

    Only summary fields are included; steps are omitted for efficiency.
    Use ``GET /api/runs/{run_id}`` to fetch the full detail of a single run.
    """
    runs = (
        db.query(RunModel)
        .order_by(RunModel.created_at.desc())
        .limit(limit)
        .all()
    )
    return runs


@app.get("/api/runs/{run_id}", response_model=RunDetailOut, tags=["runs"])
def get_run(run_id: str, db: Session = Depends(get_db)):
    """
    Return a single run and all its steps ordered by sequence number.

    Raises 404 if the run_id is not found.
    """
    run = db.get(RunModel, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found.")
    return run


# ---------------------------------------------------------------------------
# Static frontend (must be AFTER all /api/ routes)
# ---------------------------------------------------------------------------

import os
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
