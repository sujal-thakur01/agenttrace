"""
AgentTrace FastAPI server.

Exposes four endpoints:
    POST /api/runs          — ingest a complete run payload (run + steps)
    GET  /api/runs          — list runs, newest first (summary fields only)
    GET  /api/runs/{run_id} — full run with ordered steps
    GET  /api/health        — health check

Tables are auto-created on startup. CORS is open for all origins.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
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
