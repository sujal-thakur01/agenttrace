"""
AgentTrace SDK client — Run context manager and @trace_agent decorator.

Design principles:
- The SDK NEVER crashes the host application.
- Every network call has a 2-second timeout and is wrapped in try/except.
- Steps are buffered locally in the Run object and flushed as ONE payload on exit.
- If an agent function raises, the step is recorded as "failed" and the
  original exception is re-raised so the host application can handle it.

Token cost constants (configurable here):
"""

import functools
import json
import time
import traceback
import uuid
import warnings
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, List, Optional

import httpx

# ---------------------------------------------------------------------------
# Cost model constants (USD per token).
# Adjust these to match your actual LLM pricing.
# ---------------------------------------------------------------------------
PROMPT_TOKEN_COST_USD = 0.05 / 1_000_000       # $0.05 per 1M prompt tokens
COMPLETION_TOKEN_COST_USD = 0.08 / 1_000_000    # $0.08 per 1M completion tokens

# Maximum length (chars) for serialised input / output strings stored in steps.
MAX_FIELD_CHARS = 5_000

# HTTP timeout for sending the run payload to the server (seconds).
SEND_TIMEOUT_SECONDS = 2.0


# ---------------------------------------------------------------------------
# Internal data classes
# ---------------------------------------------------------------------------

@dataclass
class StepRecord:
    """
    Local representation of one agent invocation captured by @trace_agent.
    This is serialised to a dict and sent to the server as part of the run payload.
    """

    agent_name: str
    seq: int
    input: Optional[str]
    output: Optional[str]
    error: Optional[str]
    latency_ms: float
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    cost_usd: Optional[float]
    status: str  # "success" | "failed"

    def to_dict(self) -> dict:
        """Serialise to a plain dict ready for JSON encoding."""
        return {
            "agent_name": self.agent_name,
            "seq": self.seq,
            "input": self.input,
            "output": self.output,
            "error": self.error,
            "latency_ms": self.latency_ms,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "cost_usd": self.cost_usd,
            "status": self.status,
        }


# ---------------------------------------------------------------------------
# Run context manager
# ---------------------------------------------------------------------------

class Run:
    """
    Context manager that represents a single end-to-end pipeline execution.

    Creates a unique ``run_id``, records wall-clock start/end times, collects
    all step records emitted by ``@trace_agent`` decorators used within the
    block, and on exit sends the complete payload to the AgentTrace server.

    Parameters
    ----------
    pipeline_name:
        Human-readable label for this pipeline (e.g. ``"research_agent"``).
    server_url:
        Base URL of the AgentTrace server (e.g. ``"http://localhost:8000"``).

    Usage::

        with Run(pipeline_name="my_pipeline", server_url="http://localhost:8000") as run:
            result = my_agent("hello")

    If an exception escapes the ``with`` block:
    - The run is marked ``"failed"``.
    - The partial payload (including any completed steps) is still sent.
    - The exception is re-raised after sending.
    """

    # Thread-local or global "current run" used by @trace_agent to find
    # the active Run without requiring the user to pass it explicitly.
    _active_run: Optional["Run"] = None

    def __init__(self, pipeline_name: str, server_url: str) -> None:
        self.pipeline_name = pipeline_name
        self.server_url = server_url.rstrip("/")
        self.run_id: str = str(uuid.uuid4())
        self.started_at: Optional[datetime] = None
        self.ended_at: Optional[datetime] = None
        self.status: str = "partial"
        self._steps: List[StepRecord] = []
        self._seq_counter: int = 0  # incremented by each @trace_agent call

    # ------------------------------------------------------------------
    # Context manager protocol
    # ------------------------------------------------------------------

    def __enter__(self) -> "Run":
        self.started_at = datetime.now(timezone.utc)
        # Register this run as the active one so @trace_agent can find it.
        Run._active_run = self
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        """
        Called when the ``with`` block exits (normally or via exception).

        - Records the end time.
        - Sets status based on whether an exception occurred.
        - Sends the payload to the server (best-effort, never raises).
        - Returns ``False`` so that any exception is re-raised by Python.
        """
        self.ended_at = datetime.now(timezone.utc)

        if exc_type is None:
            self.status = "success"
        else:
            self.status = "failed"

        # Deregister this run so subsequent @trace_agent calls know there is
        # no active run (avoids leaking state across nested or sequential runs).
        Run._active_run = None

        # Best-effort delivery — never propagate network errors.
        self._send_payload()

        # Return False → do NOT suppress the exception.
        return False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _next_seq(self) -> int:
        """Return the next 1-based sequence number for a new step."""
        self._seq_counter += 1
        return self._seq_counter

    def _add_step(self, step: StepRecord) -> None:
        """Append a completed step record to the local buffer."""
        self._steps.append(step)

    def _build_payload(self) -> dict:
        """Assemble the full run + steps payload dict to POST to the server."""
        return {
            "id": self.run_id,
            "pipeline_name": self.pipeline_name,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "status": self.status,
            "steps": [s.to_dict() for s in self._steps],
        }

    def _send_payload(self) -> None:
        """
        POST the run payload to ``{server_url}/api/runs``.

        Failures are silently swallowed (a single warning is printed) to ensure
        the SDK never disrupts the host application.
        """
        payload = self._build_payload()
        try:
            with httpx.Client(timeout=SEND_TIMEOUT_SECONDS) as client:
                response = client.post(
                    f"{self.server_url}/api/runs",
                    json=payload,
                )
                response.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            warnings.warn(
                f"[AgentTrace] Failed to send run {self.run_id!r} to server: {exc}",
                stacklevel=2,
            )


# ---------------------------------------------------------------------------
# @trace_agent decorator
# ---------------------------------------------------------------------------

def _safe_serialize(value: Any, max_chars: int = MAX_FIELD_CHARS) -> Optional[str]:
    """
    Convert ``value`` to a human-readable string, truncated to ``max_chars``.

    Falls back to ``repr()`` if JSON serialisation fails.
    Returns ``None`` if even repr() raises (extremely rare).
    """
    if value is None:
        return None
    try:
        text = json.dumps(value, default=str, ensure_ascii=False)
    except Exception:  # noqa: BLE001
        try:
            text = repr(value)
        except Exception:  # noqa: BLE001
            return "<serialisation error>"
    return text[:max_chars]


def _extract_tokens(return_value: Any) -> tuple[Optional[int], Optional[int], Optional[float], Optional[str]]:
    """
    If ``return_value`` is a dict with ``output``, ``prompt_tokens``, and
    ``completion_tokens`` keys, extract those values and compute cost.

    Returns
    -------
    (prompt_tokens, completion_tokens, cost_usd, serialised_output)
        where ``serialised_output`` is the value of ``return_value["output"]``
        serialised to string (if the token dict pattern is detected), or the
        full return value serialised (plain value case).
    """
    if (
        isinstance(return_value, dict)
        and "output" in return_value
        and "prompt_tokens" in return_value
        and "completion_tokens" in return_value
    ):
        prompt_tokens = return_value.get("prompt_tokens")
        completion_tokens = return_value.get("completion_tokens")
        cost_usd: Optional[float] = None
        if isinstance(prompt_tokens, (int, float)) and isinstance(completion_tokens, (int, float)):
            cost_usd = (
                prompt_tokens * PROMPT_TOKEN_COST_USD
                + completion_tokens * COMPLETION_TOKEN_COST_USD
            )
        output_str = _safe_serialize(return_value["output"])
        return prompt_tokens, completion_tokens, cost_usd, output_str

    # Plain value — no token info
    return None, None, None, _safe_serialize(return_value)


def trace_agent(name: str):
    """
    Decorator factory that wraps an agent function with AgentTrace observability.

    Must be used inside an active ``Run`` context. If no ``Run`` is active, the
    wrapped function is called unmodified (a warning is printed).

    Parameters
    ----------
    name:
        Human-readable name for this agent step (e.g. ``"planner"``).

    Usage::

        with Run(pipeline_name="demo", server_url="http://localhost:8000") as run:

            @trace_agent(name="researcher")
            def researcher(query: str) -> dict:
                ...
                return {"output": "...", "prompt_tokens": 120, "completion_tokens": 60}

            researcher("some query")

    On exception
    ------------
    The step is recorded with ``status="failed"`` and the full traceback is
    stored in the ``error`` field. The original exception is then **re-raised**
    so the caller can handle it.
    """

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            active_run = Run._active_run

            if active_run is None:
                # No active run — warn once and call through transparently.
                warnings.warn(
                    f"[AgentTrace] @trace_agent({name!r}) called outside a Run context. "
                    "Skipping tracing.",
                    stacklevel=2,
                )
                return func(*args, **kwargs)

            # Serialise the function inputs (args + kwargs merged).
            input_data: dict = {}
            try:
                import inspect
                sig = inspect.signature(func)
                bound = sig.bind(*args, **kwargs)
                bound.apply_defaults()
                input_data = dict(bound.arguments)
            except Exception:  # noqa: BLE001
                input_data = {"args": args, "kwargs": kwargs}
            input_str = _safe_serialize(input_data)

            seq = active_run._next_seq()
            start_time = time.perf_counter()
            error_str: Optional[str] = None
            return_value: Any = None
            step_status = "success"

            try:
                return_value = func(*args, **kwargs)
            except Exception as exc:  # noqa: BLE001
                step_status = "failed"
                error_str = (
                    f"{type(exc).__name__}: {exc}\n\n"
                    + traceback.format_exc()
                )
                latency_ms = (time.perf_counter() - start_time) * 1000

                step = StepRecord(
                    agent_name=name,
                    seq=seq,
                    input=input_str,
                    output=None,
                    error=error_str,
                    latency_ms=round(latency_ms, 3),
                    prompt_tokens=None,
                    completion_tokens=None,
                    cost_usd=None,
                    status="failed",
                )
                active_run._add_step(step)

                # Re-raise so the host application can deal with it.
                raise

            latency_ms = (time.perf_counter() - start_time) * 1000
            prompt_tokens, completion_tokens, cost_usd, output_str = _extract_tokens(return_value)

            step = StepRecord(
                agent_name=name,
                seq=seq,
                input=input_str,
                output=output_str,
                error=None,
                latency_ms=round(latency_ms, 3),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
                status="success",
            )
            active_run._add_step(step)

            return return_value

        return wrapper

    return decorator
