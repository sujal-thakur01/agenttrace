# AgentTrace 🛩️

> A flight recorder for multi-agent AI pipelines.

AgentTrace lets you instrument any Python multi-agent pipeline with one context manager and one decorator, capturing every agent call's input, output, latency, token counts, cost, and full error traceback. A FastAPI server stores the traces in SQLite, and a React dashboard polls for new runs every three seconds so you can watch a pipeline execute in real time. The whole stack is self-hosted, requires no cloud account, and fits in two terminal commands.

---

## Origin

I built this after hitting a real problem at Deloitte's Digital Excellence Centre, where I was working on CareIQ — a five-agent healthcare triage pipeline (intake, symptom classifier, urgency scorer, recommendation generator, safety filter). When that pipeline produced wrong urgency scores, we had zero visibility into which agent broke, what it received as input, or what it actually returned. The only signal was a silent wrong answer at the end. I finished in the top 13 of 22,000+ entrants at a national GenAI hackathon to land that internship, and then spent more time debugging `print` statements than I spent building the actual agents.

LangSmith exists. Langfuse exists. Both assume you're already inside their ecosystem or willing to pay before you can see anything useful. I wanted something that required zero cloud account, fit into a `with` block, and showed me a trace in under a minute of setup. AgentTrace is what I built. It's a working, deployed, open-source tool that solves a real problem I personally hit — not a production system used by thousands, not a finished product, just an honest answer to a specific debugging pain. This version was built as a Round 3 artifact for Polaris Fellowship 2026. Total build time: approximately three days.

---

## Live Demo

🔗 [agenttrace-production.up.railway.app](https://agenttrace-production.up.railway.app)

Click **▶ Run Live Demo** in the dashboard to trigger a real 3-agent research pipeline against Groq's API and watch AgentTrace record it in real time.

---

## Screenshots

**Main dashboard — 26 runs, stat cards, cost-per-run bar chart, agent latency heatmap**

![Main dashboard showing runs table, stat cards, cost chart, and heatmap](docs/screenshot-dashboard.png)

**Run detail drawer — SUCCESS path — full 3-node flight-path chain with step input/output**

![Drawer open on a successful run showing planner → researcher → writer chain with researcher step detail including real CRISPR research input and output](docs/screenshot-drawer-success.png)

**Run detail drawer — FAILED path — planner succeeds, researcher hits deterministic error**

![Drawer open on a failed run showing planner (green) → researcher (red) chain with full ValueError traceback](docs/screenshot-drawer-failed.png)

**Pipelines view — grouped by pipeline name with run history sparkline**

![Pipelines view showing research_assistant card with color-coded sparkline dots and aggregate metrics](docs/screenshot-pipelines.png)

**Settings panel — live config from /api/config, showing Demo enabled badge**

![Settings panel showing server version, DB backend, token costs, and Demo enabled badge](docs/screenshot-settings.png)

---

## Architecture

```mermaid
flowchart TD
    A["Your Python Pipeline"] -->|"@trace_agent decorator"| B["AgentTrace SDK\n(in-memory step buffer)"]
    B -->|"Single POST on Run exit"| C["FastAPI Server"]
    C --> D["SQLite DB"]
    C --> E["React Dashboard\n(polls /api/runs every 3s)"]
    C --> F["POST /api/demo/trigger\n(Groq live demo)"]
```

---

## How it works

The SDK wraps agent functions with a decorator that records serialised input, output or exception traceback, wall-clock latency, and any token/cost metadata returned by the function. Steps buffer in memory during the `with Run(...)` block and flush as a single `POST /api/runs` on exit — including partial runs when an exception escapes. The server recomputes cost and token totals from the submitted steps as an independent cross-check, stores everything in SQLite, and serves a React dashboard that polls `/api/runs` every three seconds and highlights new arrivals without a page reload.

---

## Quick start

**1. Clone and install dependencies**

```bash
git clone https://github.com/sujal-thakur01/agenttrace.git
cd agenttrace
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

**2. Build the dashboard**

```bash
cd dashboard
npm install
npm run build
cd ..
```

This compiles the React app and writes static files to `server/static/`. The FastAPI server serves them automatically at its root URL — no separate frontend server needed.

**3. Start the server**

```bash
.venv/bin/python -m uvicorn server.main:app --reload --port 8000
```

The SQLite database is created automatically at `server/agenttrace.db` on first startup. Open `http://localhost:8000` to see the dashboard.

**4. Run the synthetic example (no API key needed)**

```bash
python examples/simple_test.py
```

Fires a fake three-step pipeline and immediately populates the dashboard with something you can click through.

**5. Run the real LLM demo (requires a free Groq key)**

```bash
cd examples
cp .env.example .env
# Edit .env and set GROQ_API_KEY=gsk_...
python demo_pipeline.py
```

Runs five real Groq completions across the planner → researcher → writer pipeline. One query is a deterministic failure trigger — see [Design decisions](#design-decisions--tradeoffs) below.

**6. Or trigger the live demo from the browser**

If `GROQ_API_KEY` is set in the server's environment, the **▶ Run Live Demo** button appears in the dashboard and calls `POST /api/demo/trigger` directly.

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

The decorator is transparent: if the function raises, `@trace_agent` records the step as `"failed"` with the full traceback and re-raises the original exception unchanged — the host pipeline never needs to know AgentTrace is there. If your agent function returns a dict with `output`, `prompt_tokens`, and `completion_tokens` keys, AgentTrace automatically computes and tracks cost using configurable per-token rates.

**Token cost model** (configurable at the top of `sdk/agenttrace/client.py`):

| Token type | Default cost |
|------------|--------------|
| Prompt | $0.05 / 1M tokens |
| Completion | $0.08 / 1M tokens |

---

## Dashboard features

- Pipeline runs table with status indicator, tokens, cost, and mini step-dot indicators
- Real-time polling (3s interval) with new-run entrance animations
- Run detail drawer: flight-path node chain (one node per agent step, colored by status) + per-step input/output/traceback panel
- Search by pipeline name and filter by ALL / SUCCESS / FAILED status
- Stat cards: total runs, success rate (with cost sparkline), total cost, total tokens
- Cost-per-run bar chart with failure runs highlighted in red
- Agent latency heatmap (quartile-colored; only populated for runs whose detail has been fetched)
- Pipelines view: runs grouped by pipeline name with color-coded run history sparkline
- Alerts: client-side rules stored in localStorage (cost threshold, consecutive failure count) with toast notifications
- Settings: live server config fetched from `/api/config` — shows token pricing and whether the Groq demo is available
- Run Diff: select any two runs and compare them side-by-side with per-step latency and cost deltas
- Export JSON: download the currently filtered run list (with cached step details)
- Keyboard shortcuts: `/` to focus search, `R` to refresh, `Esc` to close panels, `←/→` to navigate between runs in the drawer, `?` for the shortcuts reference
- Dark/light mode toggle, persisted to localStorage

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/runs` | Ingest a complete run + steps payload from the SDK |
| GET | `/api/runs?limit=50` | List runs, newest first (summary fields only) |
| GET | `/api/runs/{run_id}` | Full run detail with all steps, ordered by sequence |
| GET | `/api/health` | Liveness probe → `{"status": "ok"}` |
| GET | `/api/config` | Server config: token costs, db backend, `groq_configured` flag |
| POST | `/api/demo/trigger` | Run one live 3-agent Groq pipeline and return the new `run_id` |

Interactive Swagger UI is available at `http://localhost:8000/docs`.

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
- **Demo**: Groq Python client (`openai/gpt-oss-120b` for live demo)
- **Deploy**: Railway / any Procfile-compatible host

---

## License

MIT — see [LICENSE](LICENSE).
