"""
AgentTrace SDK
==============
Lightweight observability SDK for multi-agent AI pipelines.

Usage::

    from agenttrace import Run, trace_agent

    with Run(pipeline_name="my_pipeline", server_url="http://localhost:8000") as run:

        @trace_agent(name="planner")
        def planner(query: str) -> dict:
            ...
            return {"output": "plan text", "prompt_tokens": 100, "completion_tokens": 50}

        result = planner("What is the capital of France?")
"""

from .client import Run, trace_agent

__all__ = ["Run", "trace_agent"]
__version__ = "0.1.0"
