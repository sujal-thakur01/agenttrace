"""
AgentTrace — demo_pipeline.py
==============================
A REAL 3-agent pipeline that calls the Groq API (OpenAI-compatible endpoint)
so the AgentTrace dashboard has genuine LLM traces to display — including real
token counts pulled from the API response and a realistic failure mode.

Pipeline name: "research_assistant"
Agents (each a real Groq chat completion):
    1. planner    — produces a 2-3 line research plan for the query
    2. researcher — expands the plan into a short findings paragraph
    3. writer     — distils findings into a 3-4 sentence summary report

Failure mode:
    A standalone validator, validate_findings(), raises ValueError if the
    findings text is shorter than 40 characters. It is called inside the
    researcher agent AFTER the Groq response arrives. This exercises the
    @trace_agent failure recording path with a real traceback.

Retry logic:
    The raw Groq API call is retried once (after a 1-second sleep) on any
    exception (network error, rate-limit, etc.). Only the API call is
    retried — not the whole agent function.

How to run
----------
1. Copy .env.example → .env and fill in your free Groq API key:
       cp .env.example .env
       # edit .env and set GROQ_API_KEY=gsk_...

2. Start the AgentTrace server in another terminal:
       cd server && uvicorn main:app --reload --port 8000

3. Run this script:
       cd examples
       python demo_pipeline.py

   Override the server URL if needed:
       AGENTTRACE_SERVER_URL=http://myserver:8000 python demo_pipeline.py
       # or
       python demo_pipeline.py http://myserver:8000

Expected output (roughly):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    [RUN 1/5]  query: "What causes the northern lights?"
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      [planner]    ✓  plan: "1. Explore the …"  (tokens: 45p / 62c, 1234 ms)
      [researcher] ✓  findings: "The northern li…"  (tokens: 112p / 198c, 1891 ms)
      [writer]     ✓  report: "The aurora bore…"   (tokens: 312p / 95c, 1102 ms)
    ✅ run_id=abc123  status=success

    ...

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    [SUMMARY] 4/5 queries succeeded, 1 failed.
"""

import os
import sys
import time

# ---------------------------------------------------------------------------
# Make the SDK importable when running from the examples/ directory.
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))

# ---------------------------------------------------------------------------
# Load .env (if present) before anything else touches env vars.
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    # python-dotenv not installed — rely on the shell environment.
    pass

from groq import Groq
from agenttrace import Run, trace_agent

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

GROQ_MODEL = "openai/gpt-oss-120b"   # Fast, free-tier Groq model
MIN_FINDINGS_CHARS = 40                   # validate_findings threshold

# ---------------------------------------------------------------------------
# Groq client (initialised once at module load time)
# ---------------------------------------------------------------------------

_groq_api_key = os.environ.get("GROQ_API_KEY")
if not _groq_api_key:
    sys.exit(
        "[demo_pipeline] ERROR: GROQ_API_KEY is not set.\n"
        "  Copy examples/.env.example → examples/.env and fill in your key, or\n"
        "  export GROQ_API_KEY=gsk_... in your shell.\n"
        "  Get a free key at https://console.groq.com/"
    )

_groq_client = Groq(api_key=_groq_api_key)


# ---------------------------------------------------------------------------
# Retry helper — wraps the raw Groq API call only
# ---------------------------------------------------------------------------

def _call_groq_with_retry(messages: list[dict], model: str = GROQ_MODEL):
    """
    Call the Groq chat completions endpoint and retry once on any exception.

    Only the raw API call is retried — not the surrounding agent logic.
    On a second consecutive failure the exception propagates naturally.
    """
    try:
        return _groq_client.chat.completions.create(
            model=model,
            messages=messages,
        )
    except Exception as first_exc:
        print(f"    ⚠ Groq API error ({type(first_exc).__name__}), retrying in 1 s …")
        time.sleep(1)
        # Let any exception from the retry propagate unmodified.
        return _groq_client.chat.completions.create(
            model=model,
            messages=messages,
        )


# ---------------------------------------------------------------------------
# Standalone validator — NOT decorated with @trace_agent.
# Called from inside the researcher agent to simulate a quality gate.
# ---------------------------------------------------------------------------

def validate_findings(findings: str) -> None:
    """
    Quality gate: raise ValueError if the findings text is degenerate/empty.

    A real LLM safety refusal or an extremely brief response would typically
    produce fewer than MIN_FINDINGS_CHARS characters. Raising here lets
    @trace_agent record the researcher step as FAILED with a real traceback,
    and marks the entire Run as failed.
    """
    if len(findings.strip()) < MIN_FINDINGS_CHARS:
        raise ValueError(
            f"Researcher findings are too short ({len(findings.strip())} chars, "
            f"minimum {MIN_FINDINGS_CHARS}). "
            "LLM may have returned a refusal or degenerate response."
        )


# ---------------------------------------------------------------------------
# Agent 1 — Planner
# ---------------------------------------------------------------------------

@trace_agent(name="planner")
def run_planner(query: str) -> dict:
    """
    Planning agent: ask Groq to produce a 2-3 line research plan for the query.
    Returns the SDK token-aware dict so @trace_agent captures real usage metrics.
    """
    messages = [
        {
            "role": "system",
            "content": (
                "You are a concise research planner. "
                "Output ONLY a numbered 2-3 line research plan. "
                "No preamble, no commentary."
            ),
        },
        {
            "role": "user",
            "content": f"Create a 2-3 line research plan for this query: {query}",
        },
    ]

    response = _call_groq_with_retry(messages)
    plan = response.choices[0].message.content.strip()

    return {
        "output": plan,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    }


# ---------------------------------------------------------------------------
# Agent 2 — Researcher
# ---------------------------------------------------------------------------

@trace_agent(name="researcher")
def run_researcher(plan: str) -> dict:
    """
    Researcher agent: expand the plan into a short findings paragraph.
    Calls validate_findings() BEFORE returning — if the LLM produced a
    degenerate/very-short response this raises ValueError, which @trace_agent
    records as a failed step with a real traceback.
    """
    if "FORCE_DEMO_FAILURE" in plan:
        raise ValueError(
            "Simulated failure: this query intentionally triggers a failure "
            "to demonstrate the failure-tracing path deterministically."
        )

    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful research assistant. "
                "Given a research plan, write a concise findings paragraph "
                "(3-6 sentences) that covers the key points. "
                "Be direct and factual."
            ),
        },
        {
            "role": "user",
            "content": f"Research plan:\n{plan}\n\nProvide your findings paragraph.",
        },
    ]

    response = _call_groq_with_retry(messages)
    findings = response.choices[0].message.content.strip()

    # Quality gate — raises ValueError if findings are too short.
    # This exercises the @trace_agent failure path with a real traceback.
    validate_findings(findings)

    return {
        "output": findings,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    }


# ---------------------------------------------------------------------------
# Agent 3 — Writer
# ---------------------------------------------------------------------------

@trace_agent(name="writer")
def run_writer(findings: str) -> dict:
    """
    Writer agent: distil the research findings into a 3-4 sentence summary report.
    """
    messages = [
        {
            "role": "system",
            "content": (
                "You are a professional technical writer. "
                "Summarise the provided research findings into exactly 3-4 clear, "
                "informative sentences suitable for an executive briefing. "
                "Do not add headings or bullet points."
            ),
        },
        {
            "role": "user",
            "content": f"Research findings:\n{findings}\n\nWrite your 3-4 sentence summary report.",
        },
    ]

    response = _call_groq_with_retry(messages)
    report = response.choices[0].message.content.strip()

    return {
        "output": report,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    }


# ---------------------------------------------------------------------------
# Query list
# ---------------------------------------------------------------------------

QUERIES = [
    # Normal queries — expected to succeed reliably.
    "What causes the northern lights (aurora borealis)?",
    "How does CRISPR gene editing work at a molecular level?",
    "What are the main differences between supervised and unsupervised machine learning?",
    "Explain the economic causes of the 2008 global financial crisis.",

    # Deliberate failure trigger — see run_researcher() for why. This is not
    # relying on LLM refusal behavior (unreliable across models); it's a
    # deterministic demo hook so the failure-tracing path is always shown.
    "FORCE_DEMO_FAILURE - test the failure path",
]


# ---------------------------------------------------------------------------
# Pipeline runner
# ---------------------------------------------------------------------------

def run_pipeline(query: str, server_url: str, run_number: int, total: int) -> bool:
    """
    Execute the full 3-agent pipeline for a single query inside a Run context.

    Returns True on success, False if any step fails.
    """
    divider = "─" * 58
    print(f"\n{divider}")
    print(f"[RUN {run_number}/{total}]  query: {query!r}")
    print(divider)

    try:
        with Run(pipeline_name="research_assistant", server_url=server_url) as run:
            # ── Step 1: Planner ─────────────────────────────────────────
            plan_result = run_planner(query)
            plan_preview = plan_result["output"][:70].replace("\n", " ")
            print(
                f"  [planner]    ✓  plan: {plan_preview!r}…\n"
                f"               tokens: {plan_result['prompt_tokens']}p / "
                f"{plan_result['completion_tokens']}c"
            )

            # ── Step 2: Researcher ───────────────────────────────────────
            research_result = run_researcher(plan_result["output"])
            findings_preview = research_result["output"][:70].replace("\n", " ")
            print(
                f"  [researcher] ✓  findings: {findings_preview!r}…\n"
                f"               tokens: {research_result['prompt_tokens']}p / "
                f"{research_result['completion_tokens']}c"
            )

            # ── Step 3: Writer ───────────────────────────────────────────
            report_result = run_writer(research_result["output"])
            report_preview = report_result["output"][:70].replace("\n", " ")
            print(
                f"  [writer]     ✓  report: {report_preview!r}…\n"
                f"               tokens: {report_result['prompt_tokens']}p / "
                f"{report_result['completion_tokens']}c"
            )

        print(f"✅ run_id={run.run_id}  status={run.status}")
        return True

    except ValueError as exc:
        # validate_findings() raised — researcher step recorded as failed.
        print(f"  [researcher] ✗  FAILED — {exc}")
        print(f"❌ run_id={run.run_id}  status={run.status}  (researcher validation failed)")
        return False

    except Exception as exc:
        # Unexpected error (network, Groq API, etc.)
        print(f"  ✗  UNEXPECTED ERROR — {type(exc).__name__}: {exc}")
        print(f"❌ run_id={run.run_id}  status={run.status}")
        return False


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    # Server URL: CLI arg > env var > default
    if len(sys.argv) > 1:
        server_url = sys.argv[1]
    else:
        server_url = os.environ.get("AGENTTRACE_SERVER_URL", "http://localhost:8000")

    print("=" * 60)
    print("  AgentTrace — Real LLM Pipeline Demo (Groq)")
    print(f"  Model  : {GROQ_MODEL}")
    print(f"  Server : {server_url}")
    print(f"  Queries: {len(QUERIES)}")
    print("=" * 60)

    results: list[tuple[str, bool]] = []
    for i, query in enumerate(QUERIES, start=1):
        success = run_pipeline(query, server_url, i, len(QUERIES))
        results.append((query, success))

    # ── Summary ─────────────────────────────────────────────────────────
    succeeded = sum(1 for _, ok in results if ok)
    failed = len(results) - succeeded
    print("\n" + "=" * 60)
    print(f"  [SUMMARY] {succeeded}/{len(results)} queries succeeded, {failed} failed.")
    print("=" * 60)

    for query, ok in results:
        icon = "✅" if ok else "❌"
        print(f"  {icon}  {query!r}")

    print(f"\n  Inspect recorded runs:")
    print(f"  curl {server_url}/api/runs | python -m json.tool")
    print(f"  Swagger UI: {server_url}/docs")


if __name__ == "__main__":
    main()
