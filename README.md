# AgentTrace 🛩️

A flight recorder for multi-agent AI pipelines — see exactly which agent failed, why, how long it took, and what it cost.

---

## The problem

During an internship I worked on CareIQ, a healthcare triage assistant built as a five-agent pipeline: intake, symptom classifier, urgency scorer, recommendation generator, and a final safety filter. When the pipeline misbehaved — wrong urgency score, truncated recommendation — we had no way to tell which agent produced the bad output, whether the failure was in the LLM call or the surrounding logic, or how much each invocation cost. Debugging meant sprinkling `print` statements through five functions and re-running the whole pipeline until something surfaced.

The existing observability tools I looked at — LangSmith, Langfuse, Weights & Biases — all assume you're deep in their ecosystem or on a paid tier before you can see anything useful. For a quick debugging loop during a prototype, that's too heavy. I wanted something that fit in a single `with` block, required no cloud account, and gave me a readable trace in under a minute of setup.

AgentTrace is what I built. It's a minimal, self-hosted observability layer: a Python decorator captures every agent call's input, output, latency, token usage, and errors; a FastAPI server stores them in SQLite; and a React dashboard lets you browse runs, drill into individual steps, and spot failures instantly. The whole stack runs locally with two terminal commands.

---

## Live demo

🔗 [Live deployed instance](DEPLOY_URL_HERE)

---

## How it works

```mermaid
flowchart TD
    A["Your Python Pipeline"] -->|"@trace_agent decorator"| B["AgentTrace SDK\n(in-memory step buffer)"]
    B -->|"single POST on Run.__exit__"| C["FastAPI Server\n(server/main.py)"]
    C --> D["SQLite\n(agenttrace.db)"]
    D -->|"GET /api/runs (polled every 3s)"| E["React Dashboard\n(localhost:8000)"]
```

Each `@trace_agent`-decorated function is wrapped so that on every call the SDK records: the serialised input, the output or exception traceback, wall-clock latency, and any token/cost metadata returned by the function. Steps are buffered in memory during the run and flushed as a single `POST /api/runs` payload when the `with Run(...)` context manager exits — even if an exception escaped the block. The server recomputes cost and token totals independently as a cross-check, then persists everything to SQLite. The dashboard polls `/api/runs` every three seconds and highlights new arrivals without a page reload.

---

## Quick start

### 1 — Install dependencies

```bash
pip install -r requirements.txt
```

### 2 — Build the dashboard

```bash
cd dashboard
npm install
npm run build
cd ..
```

This compiles the React app and writes static files to `server/static/`. The FastAPI server serves them automatically at its root URL — no separate frontend server needed.

### 3 — Start the server

```bash
uvicorn server.main:app --reload --port 8000
```

The SQLite database is created automatically at `server/agenttrace.db` on first startup. Open `http://localhost:8000` to see the dashboard.

### 4 — Run the synthetic example (no API key needed)

```bash
python examples/simple_test.py
```

This fires a fake three-step pipeline and immediately populates the dashboard with a run you can click through.

### 5 — Run the real LLM demo (requires a Groq API key)

`examples/demo_pipeline.py` runs a genuine three-agent research pipeline against the [Groq API](https://console.groq.com/) (free tier available) using `llama-3.3-70b-versatile`. It produces real token counts, real latencies, and a deterministic failure path — giving the dashboard something genuinely interesting to display.

```bash
# One-time setup
cd examples
cp .env.example .env
# Edit .env and paste your GROQ_API_KEY

# Run
python demo_pipeline.py
```

The pipeline structure:

| Step | Agent | What it does |
|------|-------|--------------|
| 1 | `planner` | Generates a 2–3 line research plan for the input query |
| 2 | `researcher` | Expands the plan into a findings paragraph; validates length |
| 3 | `writer` | Distils findings into a 3–4 sentence executive summary |

One query in the list is intentionally adversarial to trigger the failure path — the `researcher` step is marked `failed` with the full traceback, and the run status is set to `failed` in the server.

---

## SDK usage

```python
import sys
sys.path.insert(0, "sdk")   # or: pip install -e sdk/

from agenttrace import Run, trace_agent

@trace_agent(name="planner")
def planner(query: str) -> dict:
    # Return a token-aware dict to capture cost metrics
    return {
        "output": "my plan",
        "prompt_tokens": 100,
        "completion_tokens": 50,
    }

with Run(pipeline_name="my_pipeline", server_url="http://localhost:8000") as run:
    result = planner("What is the meaning of life?")
```

The decorator is transparent: if the function raises, `@trace_agent` records the step as `"failed"` with the full traceback and re-raises the original exception unchanged. The host pipeline never needs to know AgentTrace is there.

**Token cost model** (configurable at the top of `sdk/agenttrace/client.py`):

| Token type | Default cost |
|------------|--------------|
| Prompt | $0.05 / 1M tokens |
| Completion | $0.08 / 1M tokens |

---

## Design decisions & tradeoffs

These are the choices that shaped the implementation. Each one involved a real tradeoff, not just a default.

### SQLite first, not Postgres

SQLite was chosen for zero-config local development — no database server to install, no connection string to manage, the file just appears. The ORM layer (SQLAlchemy) is database-agnostic, so switching to Postgres is a single environment variable change: swap `sqlite:///./agenttrace.db` for `postgresql+psycopg2://user:pass@host/db` in `server/db.py` (or better, read it from a `DATABASE_URL` env var, which is the standard Railway/Heroku pattern). That migration is on the roadmap but wasn't necessary for a local-first tool.

### Global `_active_run` class variable, not `contextvars`

The SDK tracks the current run via a class-level variable on the `Run` class. This works correctly for the intended use case: sequential single-pipeline runs in a single thread, which is what the demo and most scripted pipelines are. It is not safe for concurrent runs across threads or for async tasks, where two simultaneous `with Run(...)` blocks would corrupt each other's state.

The correct fix is straightforward — replace the class variable with a `contextvars.ContextVar`, which gives thread-local and async-task-local semantics automatically. This wasn't done in the initial build because the project was time-boxed and the single-pipeline sequential case was the only one actually tested. It's documented here as a known limitation rather than silently shipped as if it were general-purpose.

### Deterministic failure demo, not relying on LLM refusal behavior

An early version of the demo tried to trigger a natural failure by sending an adversarial query that I expected the LLM to refuse or answer poorly. Modern reasoning models (including the ones available on Groq's free tier) reliably produce plausible-sounding full-length answers even for nonsensical inputs, so the failure path simply never fired during testing. The demo would run without ever showing a `failed` step, which defeated the point.

Instead, I added a deterministic trigger: `validate_findings()` raises `ValueError` if the researcher's output is under 40 characters. The adversarial query is constructed to produce a short answer, making the failure reproducible. The tradeoff is that it's a synthetic failure condition rather than an organic LLM error — but it reliably demonstrates the failure-recording path every time, which matters more for a demo than purity.

### One POST on Run exit, not streaming

Steps are buffered in memory and sent as a single payload when the `with Run(...)` block exits. This avoids websocket infrastructure, keeps the SDK dependency-light, and covers the common case where a multi-agent pipeline completes in seconds or a few minutes. The latency tradeoff — dashboard doesn't update until the run finishes — is acceptable for that workload. For long-running pipelines (hours, many steps) a streaming approach with per-step POSTs would be more appropriate.

### Server-side total recomputation

`POST /api/runs` independently recalculates `total_cost_usd` and `total_tokens` by summing the submitted steps, then stores the server-computed value rather than the client-provided one. This acts as a validation cross-check: if the SDK's client-side arithmetic drifts from reality (rounding, model pricing update, SDK bug), the server's value is still correct. It also means the API is safe to call from any client, not just the official SDK.

---

## What's next (roadmap)

- Publish SDK to PyPI (`pip install agenttrace`)
- Postgres support as a `DATABASE_URL` config swap
- Alerting — webhook or Slack notification on pipeline failure
- Replay — re-run a failed step against the current pipeline with the same recorded input
- `contextvars.ContextVar`-based run tracking for thread and async safety
- Auth for shared team usage

---

## Tech stack

- **Backend**: Python, FastAPI, SQLAlchemy, SQLite, Uvicorn
- **Frontend**: React, Vite, vanilla CSS (no UI framework)
- **Demo**: Groq Python client (`llama-3.3-70b-versatile`)
- **Deploy**: Railway / any Procfile-compatible host

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/runs` | Ingest a complete run + steps payload |
| GET | `/api/runs?limit=50` | List runs, newest first (summary fields only) |
| GET | `/api/runs/{run_id}` | Full run detail with all steps |
| GET | `/api/health` | Liveness probe → `{"status": "ok"}` |

Interactive Swagger UI is available at `http://localhost:8000/docs`.

---

## License

MIT — see [LICENSE](LICENSE).
