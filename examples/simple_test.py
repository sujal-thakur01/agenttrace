"""
AgentTrace — simple_test.py
============================
A fake 3-step pipeline that exercises the SDK against a running AgentTrace
server at http://localhost:8000 without making real LLM calls.

Two scenarios are demonstrated:
    1. Happy path — all three steps succeed.
    2. Failure path — step 2 raises an exception; the run is still recorded.

How to run
----------
1. Start the server:
        cd server && uvicorn main:app --reload

2. In another terminal:
        cd examples
        python simple_test.py

Expected output (roughly):
    [DEMO] ── Happy-path pipeline ──
    [planner]    → "Here is my research plan..."   (latency: ~100 ms)
    [researcher] → "Researched: ..."               (latency: ~200 ms)
    [writer]     → "Final report: ..."             (latency: ~150 ms)
    Run abc123 sent to server.

    [DEMO] ── Failure pipeline ──
    [planner]    → "Here is my research plan..."
    [researcher] raised ValueError — step recorded as failed, exception re-raised.
    Run def456 sent to server (partial/failed).
"""

import sys
import time

# Make sure the SDK is importable when running from the examples/ directory.
sys.path.insert(0, "../sdk")

from agenttrace import Run, trace_agent


# ---------------------------------------------------------------------------
# Fake agent functions
# ---------------------------------------------------------------------------

@trace_agent(name="planner")
def run_planner(query: str) -> dict:
    """
    Fake planning agent. Sleeps briefly to simulate LLM latency and returns
    a dict in the token-aware format recognised by the SDK.
    """
    time.sleep(0.1)  # Simulate ~100 ms LLM call
    return {
        "output": f"Here is my research plan for: {query!r}",
        "prompt_tokens": 80,
        "completion_tokens": 40,
    }


@trace_agent(name="researcher")
def run_researcher(plan: str, should_fail: bool = False) -> dict:
    """
    Fake research agent. Optionally raises to exercise the failure path.
    """
    time.sleep(0.2)  # Simulate ~200 ms tool call
    if should_fail:
        raise ValueError("Could not fetch search results — simulated network error.")
    return {
        "output": f"Researched: {plan[:50]}...",
        "prompt_tokens": 200,
        "completion_tokens": 120,
    }


@trace_agent(name="writer")
def run_writer(research: str) -> dict:
    """
    Fake report-writer agent. Returns a plain-dict result with token counts.
    """
    time.sleep(0.15)  # Simulate ~150 ms LLM call
    return {
        "output": f"Final report: {research[:60]}...",
        "prompt_tokens": 350,
        "completion_tokens": 200,
    }


# ---------------------------------------------------------------------------
# Scenario 1 — Happy path
# ---------------------------------------------------------------------------

def run_happy_pipeline(server_url: str = "http://localhost:8000") -> None:
    """Execute all three steps successfully."""
    print("\n[DEMO] ── Happy-path pipeline ──")

    with Run(pipeline_name="research_pipeline_happy", server_url=server_url) as run:
        plan_result = run_planner("What are the latest advances in AI safety?")
        print(f"  [planner]    → {plan_result['output']!r}")

        research_result = run_researcher(plan_result["output"], should_fail=False)
        print(f"  [researcher] → {research_result['output']!r}")

        report_result = run_writer(research_result["output"])
        print(f"  [writer]     → {report_result['output']!r}")

    print(f"  Run {run.run_id!r} sent to server (status={run.status!r}).")


# ---------------------------------------------------------------------------
# Scenario 2 — Failure path (step 2 raises)
# ---------------------------------------------------------------------------

def run_failure_pipeline(server_url: str = "http://localhost:8000") -> None:
    """
    Step 2 (researcher) raises an exception.

    The SDK records the failed step and sends the partial run payload to the
    server before re-raising the exception. We catch it here so the script
    can continue to demonstrate recovery.
    """
    print("\n[DEMO] ── Failure pipeline (step 2 raises) ──")

    try:
        with Run(pipeline_name="research_pipeline_failure", server_url=server_url) as run:
            plan_result = run_planner("Explain quantum entanglement simply.")
            print(f"  [planner]    → {plan_result['output']!r}")

            # This will raise ValueError — the SDK catches it, records the
            # step as "failed", then re-raises.
            run_researcher(plan_result["output"], should_fail=True)

    except ValueError as exc:
        print(f"  [researcher] raised {type(exc).__name__}: {exc}")
        print(f"  Run {run.run_id!r} sent to server (status={run.status!r}).")
        print("  Exception was re-raised and caught here — host app continues normally.")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    server_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
    print(f"AgentTrace simple_test.py — targeting server at {server_url}")

    run_happy_pipeline(server_url)
    run_failure_pipeline(server_url)

    print("\n[DONE] Both scenarios finished. Check the server for recorded runs:")
    print(f"  curl {server_url}/api/runs | python -m json.tool")
