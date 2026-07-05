# AgentTrace 🛩️

> Open-source flight recorder for multi-agent AI pipelines.

AgentTrace lets you instrument any Python AI pipeline with one context manager and one decorator. Every agent call — its inputs, outputs, latency, token usage, and errors — is recorded and sent to a local REST server for storage and querying.

---

## Project layout

```
agenttrace/
├── sdk/agenttrace/      # pip-installable SDK (Run + @trace_agent)
│   ├── __init__.py
│   └── client.py
├── server/              # FastAPI + SQLAlchemy server
│   ├── main.py
│   ├── models.py
│   └── db.py
├── examples/
│   └── simple_test.py   # Demo pipeline (no real LLM calls)
└── requirements.txt
```

---

## Quick start

### 1 — Install dependencies

```bash
pip install -r requirements.txt
```

### 2 — Start the server

```bash
cd server
uvicorn main:app --reload --port 8000
```

The SQLite database is created automatically at `server/agenttrace.db` on first start.

### 3 — Run the example

```bash
cd examples
python simple_test.py
```

### 4 — Query the API

```bash
# List recent runs
curl http://localhost:8000/api/runs | python -m json.tool

# Full detail for a specific run
curl http://localhost:8000/api/runs/<run_id> | python -m json.tool
```

Interactive Swagger UI: http://localhost:8000/docs

---

## SDK usage

```python
import sys
sys.path.insert(0, "sdk")          # or pip install -e sdk/

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

**Token cost model** (configurable at the top of `sdk/agenttrace/client.py`):

| Token type  | Default cost         |
|-------------|----------------------|
| Prompt      | $0.05 / 1M tokens    |
| Completion  | $0.08 / 1M tokens    |

---

## API reference

| Method | Path                   | Description                            |
|--------|------------------------|----------------------------------------|
| POST   | `/api/runs`            | Ingest a complete run + steps payload  |
| GET    | `/api/runs?limit=50`   | List runs, newest first (summary only) |
| GET    | `/api/runs/{run_id}`   | Full run detail with all steps         |
| GET    | `/api/health`          | Liveness probe → `{"status": "ok"}`   |

---

## Design decisions

- **Never crash the host** — every network call in the SDK is wrapped in `try/except` with a 2-second timeout. Failures produce a single `warnings.warn` and execution continues.
- **One payload, one POST** — steps are buffered in memory and sent as a single JSON body on `Run.__exit__`, including partial runs when an exception escapes.
- **Exception pass-through** — if an agent function raises, `@trace_agent` records the step as `"failed"` (with full traceback) and **re-raises** the original exception unchanged.
- **Server-side validation** — `POST /api/runs` recomputes `total_cost_usd` and `total_tokens` independently as a cross-check against the SDK values.
