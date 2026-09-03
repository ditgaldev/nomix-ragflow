#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Recovery contracts for side effects that cannot join the Gateway database transaction."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from common.constants import TaskStatus

RecoveryDecision = Literal["applied", "unknown"]
PageIndexRecoveryAction = Literal["applied", "resume", "unknown"]


@dataclass(frozen=True)
class RecoveryPlan:
    """Credential-free intent persisted before crossing the side-effect boundary."""

    strategy: str = "manual"
    descriptor: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RecoveryOutcome:
    """An authoritative adapter probe result; unknown must always fail closed."""

    decision: RecoveryDecision
    data: Any = None
    meta: dict[str, Any] = field(default_factory=dict)
    status: int = 200

    @classmethod
    def unknown(cls) -> RecoveryOutcome:
        return cls("unknown")


def command_target_ids(operation: str, prepared: Any) -> list[str]:
    """Extract explicit mutation targets without confusing nested path resources."""

    payload = prepared.payload or {}
    for key in ("ids", "documentIds"):
        values = payload.get(key)
        if isinstance(values, list):
            return [str(value) for value in values]
    path_key = {
        "datasets": "dataset_id",
        "chunks": "chunk_id",
        "chats": "chat_id",
        "chatSessions": "session_id",
        "agentSessions": "session_id",
        "agents": "agent_id",
    }.get(operation.partition(".")[0], "document_id")
    value = prepared.path_args.get(path_key)
    return [str(value)] if value is not None else []


def page_index_recovery_action(
    before_run: str,
    before_task_ids: set[str],
    current_run: str,
    current_task_ids: set[str],
) -> PageIndexRecoveryAction:
    """Classify native parse evidence without treating RUNNING alone as success."""

    if current_task_ids - before_task_ids:
        return "applied"
    if current_run == TaskStatus.RUNNING.value and not current_task_ids:
        return "resume"
    if current_run == before_run and current_task_ids == before_task_ids:
        return "resume"
    return "unknown"


__all__ = ["RecoveryOutcome", "RecoveryPlan", "command_target_ids", "page_index_recovery_action"]
