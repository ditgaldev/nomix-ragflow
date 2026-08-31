#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from typing import Literal

Risk = Literal["read", "write", "destructive"]
Idempotency = Literal["none", "supported", "required"]
MAX_PAGE_LIMIT = 100
VERSIONED_OPERATIONS = frozenset(
    {
        "datasets.update",
        "datasets.delete",
        "datasets.updateMetadataConfig",
        "documents.update",
        "documents.delete",
        "chunks.update",
        "chunks.delete",
        "chats.update",
        "chats.delete",
        "chatSessions.update",
        "chatSessions.delete",
        "agents.update",
        "agents.delete",
        "agentSessions.delete",
        "memories.update",
        "memories.delete",
        "memoryMessages.update",
        "memoryMessages.delete",
    }
)
_OPERATION_PATTERN = re.compile(r"^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$")
_ACTION_PATTERN = re.compile(r"^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$")
_CAPABILITY_FIELDS = {
    "operation",
    "method",
    "path",
    "requiredAction",
    "additionalRequiredActions",
    "resourceType",
    "risk",
    "idempotency",
    "clientMethod",
    "agentTool",
    "agentAction",
    "agentKind",
}


@dataclass(frozen=True)
class Capability:
    operation: str
    method: str
    path: str
    required_action: str
    additional_required_actions: tuple[str, ...]
    resource_type: str
    risk: Risk
    idempotency: Idempotency
    client_method: str
    agent_tool: str | None
    agent_action: str | None
    agent_kind: Literal["chat", "agent"] | None

    @property
    def required_actions(self) -> frozenset[str]:
        return frozenset((self.required_action, *self.additional_required_actions))

    @property
    def quart_path(self) -> str:
        return re.sub(
            r"\{([A-Za-z][A-Za-z0-9]*)\}",
            lambda match: f"<{_camel_to_snake(match.group(1))}>",
            self.path,
        )


def _camel_to_snake(value: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()


@lru_cache(maxsize=1)
def manifest() -> dict:
    content = files(__package__).joinpath("capabilities.v1.json").read_text(encoding="utf-8")
    value = json.loads(content)
    if value.get("standardVersion") != "v1" or value.get("service") != "nomix-ragflow" or value.get("plane") != "data":
        raise RuntimeError("Business Gateway capability manifest identity is invalid")
    seen_operations: set[str] = set()
    seen_routes: set[tuple[str, str]] = set()
    seen_agent_bindings: set[tuple[str, str, str | None]] = set()
    for operation in value.get("operations", []):
        if not isinstance(operation, dict) or set(operation) - _CAPABILITY_FIELDS:
            raise RuntimeError("Business Gateway capabilities must be closed objects")
        missing = _CAPABILITY_FIELDS - {"agentTool", "agentAction", "agentKind"} - set(operation)
        if missing:
            raise RuntimeError(f"Business Gateway capability is missing fields: {sorted(missing)}")
        operation_id = operation["operation"]
        route = (operation["method"].upper(), operation["path"])
        actions = [operation["requiredAction"], *operation.get("additionalRequiredActions", [])]
        if not isinstance(operation_id, str) or not _OPERATION_PATTERN.fullmatch(operation_id):
            raise RuntimeError(f"Invalid Business Gateway operation: {operation_id}")
        if route[0] not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
            raise RuntimeError(f"Invalid Business Gateway method: {route[0]}")
        if not isinstance(route[1], str) or not route[1].startswith("/") or route[1].startswith("/api/"):
            raise RuntimeError(f"Invalid Business Gateway path: {route[1]}")
        if not actions or any(not isinstance(action, str) or not _ACTION_PATTERN.fullmatch(action) for action in actions):
            raise RuntimeError(f"Invalid Business Gateway actions for {operation_id}")
        if operation["risk"] not in {"read", "write", "destructive"}:
            raise RuntimeError(f"Invalid Business Gateway risk for {operation_id}")
        if operation["idempotency"] not in {"none", "supported", "required"}:
            raise RuntimeError(f"Invalid Business Gateway idempotency for {operation_id}")
        if operation["risk"] != "read" and operation["idempotency"] == "none":
            raise RuntimeError(f"Business Gateway write lacks idempotency for {operation_id}")
        if not isinstance(operation["clientMethod"], str) or not operation["clientMethod"]:
            raise RuntimeError(f"Invalid Business Gateway client method for {operation_id}")
        if operation.get("agentTool") is not None and not isinstance(operation["agentTool"], str):
            raise RuntimeError(f"Invalid Business Gateway Agent tool for {operation_id}")
        agent_fields = (operation.get("agentTool"), operation.get("agentAction"))
        if (agent_fields[0] is None) != (agent_fields[1] is None):
            raise RuntimeError(f"Business Gateway Agent tool and action must be declared together for {operation_id}")
        if agent_fields[1] is not None and (not isinstance(agent_fields[1], str) or not agent_fields[1]):
            raise RuntimeError(f"Invalid Business Gateway Agent action for {operation_id}")
        if operation.get("agentKind") not in {None, "chat", "agent"}:
            raise RuntimeError(f"Invalid Business Gateway Agent kind for {operation_id}")
        if operation.get("agentKind") is not None and operation.get("agentTool") != "ragflow_manage_sessions":
            raise RuntimeError(f"Business Gateway Agent kind is only valid for session tools: {operation_id}")
        if operation.get("agentTool") is not None:
            binding = (operation["agentTool"], operation["agentAction"], operation.get("agentKind"))
            if binding in seen_agent_bindings:
                raise RuntimeError(f"Duplicate Business Gateway Agent binding: {binding}")
            seen_agent_bindings.add(binding)
        if operation_id in seen_operations:
            raise RuntimeError(f"Duplicate Business Gateway operation: {operation_id}")
        if route in seen_routes:
            raise RuntimeError(f"Duplicate Business Gateway route: {route[0]} {route[1]}")
        seen_operations.add(operation_id)
        seen_routes.add(route)
    return value


@lru_cache(maxsize=1)
def capabilities() -> tuple[Capability, ...]:
    return tuple(
        Capability(
            operation=item["operation"],
            method=item["method"].upper(),
            path=item["path"],
            required_action=item["requiredAction"],
            additional_required_actions=tuple(item.get("additionalRequiredActions", [])),
            resource_type=item["resourceType"],
            risk=item["risk"],
            idempotency=item["idempotency"],
            client_method=item["clientMethod"],
            agent_tool=item.get("agentTool"),
            agent_action=item.get("agentAction"),
            agent_kind=item.get("agentKind"),
        )
        for item in manifest()["operations"]
    )


@lru_cache(maxsize=1)
def capability_by_operation() -> dict[str, Capability]:
    return {item.operation: item for item in capabilities()}


@lru_cache(maxsize=1)
def action_names() -> frozenset[str]:
    return frozenset(action for item in capabilities() for action in item.required_actions)


def requires_resource_version(operation: str) -> bool:
    """Whether a mutation requires an If-Match optimistic precondition."""

    return operation in VERSIONED_OPERATIONS
