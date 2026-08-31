#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Fail-closed capability analysis for Agent Canvas execution.

Business Gateway callers may invoke only Canvas components whose effects are
fully covered by this service's action and data-scope model.  Connector, MCP,
network, SQL, code-execution and unknown components remain available on the
management plane, but cannot be executed through the business data plane.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .errors import BusinessGatewayError

MAX_AGENT_COMPONENTS = 1_000

# Components with no authority beyond the already-authorized session invoke.
# Answer and Generate are retained because persisted Canvas DSLs can contain
# their historical rag.flow names even though current canvases use Message/LLM.
_SESSION_COMPONENTS = frozenset(
    {
        "Agent",
        "Answer",
        "Begin",
        "Categorize",
        "DataOperations",
        "ExitLoop",
        "Generate",
        "Iteration",
        "IterationItem",
        "ListOperations",
        "LLM",
        "Loop",
        "LoopItem",
        "Message",
        "StringTransform",
        "Switch",
        "UserFillUp",
        "VariableAggregator",
        "VariableAssigner",
    }
)
_KNOWLEDGE_COMPONENTS = frozenset({"Retrieval"})


@dataclass(frozen=True)
class AgentCapabilityAnalysis:
    component_names: frozenset[str]
    required_actions: frozenset[str]


def analyze_agent_dsl(value: Any, request_id: str) -> AgentCapabilityAnalysis:
    """Analyze the exact persisted DSL that the Canvas runtime will execute."""

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise _not_allowed(request_id, ["invalid-dsl"]) from error
    if not isinstance(value, dict) or not isinstance(value.get("components"), dict):
        raise _not_allowed(request_id, ["invalid-dsl"])

    component_names: set[str] = set()
    uses_mcp = False
    visited = 0

    def visit(member: Any) -> None:
        nonlocal uses_mcp, visited
        if isinstance(member, dict):
            for key, nested in member.items():
                normalized = "".join(character for character in str(key).lower() if character.isalnum())
                if normalized == "componentname":
                    if not isinstance(nested, str) or not nested.strip():
                        raise _not_allowed(request_id, ["invalid-component"])
                    visited += 1
                    if visited > MAX_AGENT_COMPONENTS:
                        raise _not_allowed(request_id, ["component-limit-exceeded"])
                    component_names.add(nested.strip())
                elif normalized == "mcp" and nested:
                    uses_mcp = True
                visit(nested)
        elif isinstance(member, list):
            for nested in member:
                visit(nested)

    visit(value["components"])
    if not component_names:
        raise _not_allowed(request_id, ["missing-components"])

    blocked = component_names - _SESSION_COMPONENTS - _KNOWLEDGE_COMPONENTS
    if uses_mcp:
        blocked.add("MCP")
    if blocked:
        raise _not_allowed(request_id, sorted(blocked))

    required_actions = frozenset({"knowledge:retrieve"}) if component_names & _KNOWLEDGE_COMPONENTS else frozenset()
    return AgentCapabilityAnalysis(frozenset(component_names), required_actions)


def _not_allowed(request_id: str, component_names: list[str]) -> BusinessGatewayError:
    return BusinessGatewayError(
        "AGENT_CAPABILITY_NOT_ALLOWED",
        "The Agent contains capabilities that are not available on the Business Gateway data plane.",
        status=403,
        request_id=request_id,
        details={"componentTypes": component_names},
    )
