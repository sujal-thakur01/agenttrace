"""
server/demo_runner.py — self-contained 3-agent demo pipeline for the dashboard
"Run Live Demo" button.

Imports Run and trace_agent directly from the SDK (sdk/agenttrace).
Does NOT duplicate any SDK logic.
"""

import os
import random
import sys
import time

# Make the SDK importable relative to the repo root (server/ is one level down).
_repo_root = os.path.dirname(os.path.dirname(__file__))
sdk_path = os.path.join(_repo_root, "sdk")
if sdk_path not in sys.path:
    sys.path.insert(0, sdk_path)

from agenttrace import Run, trace_agent  # noqa: E402

GROQ_MODEL = "openai/gpt-oss-120b"
MIN_FINDINGS_CHARS = 40

_NORMAL_QUERIES = [
    "What causes the northern lights (aurora borealis)?",
    "How does CRISPR gene editing work at a molecular level?",
    "What are the main differences between supervised and unsupervised machine learning?",
    "Explain the economic causes of the 2008 global financial crisis.",
]

_FAILURE_QUERY = "FORCE_DEMO_FAILURE - test the failure path"


def _pick_query() -> str:
    """~80% normal, ~20% failure trigger."""
    if random.random() < 0.20:
        return _FAILURE_QUERY
    return random.choice(_NORMAL_QUERIES)


def _groq_client():
    """Lazy-import Groq so a missing key gives a clear error at call time."""
    from groq import Groq  # type: ignore[import]
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise EnvironmentError("GROQ_API_KEY is not set in the server environment.")
    return Groq(api_key=api_key)


def _call_with_retry(client, messages: list[dict]) -> object:
    try:
        return client.chat.completions.create(model=GROQ_MODEL, messages=messages)
    except Exception:
        time.sleep(1)
        return client.chat.completions.create(model=GROQ_MODEL, messages=messages)


def validate_findings(findings: str) -> None:
    if len(findings.strip()) < MIN_FINDINGS_CHARS:
        raise ValueError(
            f"Researcher findings too short ({len(findings.strip())} chars, "
            f"minimum {MIN_FINDINGS_CHARS}). Degenerate LLM response."
        )


@trace_agent(name="planner")
def run_planner(query: str) -> dict:
    client = _groq_client()
    resp = _call_with_retry(client, [
        {"role": "system", "content": (
            "You are a concise research planner. "
            "Output ONLY a numbered 2-3 line research plan. No preamble."
        )},
        {"role": "user", "content": f"Create a 2-3 line research plan for: {query}"},
    ])
    return {
        "output": resp.choices[0].message.content.strip(),
        "prompt_tokens": resp.usage.prompt_tokens,
        "completion_tokens": resp.usage.completion_tokens,
    }


@trace_agent(name="researcher")
def run_researcher(plan: str) -> dict:
    if "FORCE_DEMO_FAILURE" in plan:
        raise ValueError(
            "Simulated failure: deterministic trigger for demo failure-tracing path."
        )
    client = _groq_client()
    resp = _call_with_retry(client, [
        {"role": "system", "content": (
            "You are a helpful research assistant. "
            "Given a research plan, write a concise findings paragraph (3-6 sentences). "
            "Be direct and factual."
        )},
        {"role": "user", "content": f"Research plan:\n{plan}\n\nProvide your findings paragraph."},
    ])
    findings = resp.choices[0].message.content.strip()
    validate_findings(findings)
    return {
        "output": findings,
        "prompt_tokens": resp.usage.prompt_tokens,
        "completion_tokens": resp.usage.completion_tokens,
    }


@trace_agent(name="writer")
def run_writer(findings: str) -> dict:
    client = _groq_client()
    resp = _call_with_retry(client, [
        {"role": "system", "content": (
            "You are a professional technical writer. "
            "Summarise the research findings into exactly 3-4 clear sentences "
            "suitable for an executive briefing. No headings or bullet points."
        )},
        {"role": "user", "content": f"Research findings:\n{findings}\n\nWrite your 3-4 sentence summary."},
    ])
    return {
        "output": resp.choices[0].message.content.strip(),
        "prompt_tokens": resp.usage.prompt_tokens,
        "completion_tokens": resp.usage.completion_tokens,
    }


def run_demo(server_url: str) -> str:
    """
    Execute one random demo run and return the run_id.
    Raises on configuration error (missing key) or unrecoverable API error.
    The run is always flushed to the server (even on agent failure) by the SDK.
    """
    query = _pick_query()

    with Run(pipeline_name="research_assistant", server_url=server_url) as run:
        plan_result = run_planner(query)

        try:
            research_result = run_researcher(plan_result["output"])
            run_writer(research_result["output"])
        except ValueError:
            # Researcher failed — run is marked failed by SDK on __exit__.
            # Don't re-raise; let __exit__ handle status and flush payload.
            pass

    return run.run_id
