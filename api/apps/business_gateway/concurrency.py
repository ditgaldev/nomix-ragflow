#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Gateway-owned optimistic concurrency over existing RAGFlow timestamps."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
from dataclasses import dataclass
from typing import Any

from api.db.db_models import API4Conversation, Conversation, Dialog, Document, Knowledgebase, Memory, UserCanvas

from .capabilities import Capability, requires_resource_version
from .errors import BusinessGatewayError, resource_not_found
from .types import PreparedAuthorization, RagFlowExecutionContext

logger = logging.getLogger(__name__)
_NUMERIC_ETAG = re.compile(r"^[1-9][0-9]*$")
_TARGETS: dict[str, tuple[Any, str, str]] = {
    "datasets.update": (Knowledgebase, "dataset_id", "dataset"),
    "datasets.delete": (Knowledgebase, "dataset_id", "dataset"),
    "datasets.updateMetadataConfig": (Knowledgebase, "dataset_id", "dataset"),
    "documents.update": (Document, "document_id", "document"),
    "documents.delete": (Document, "document_id", "document"),
    # Chunks live outside the relational database; their document is the
    # durable owner and therefore the optimistic concurrency boundary.
    "chunks.update": (Document, "document_id", "document"),
    "chunks.delete": (Document, "document_id", "document"),
    "chats.update": (Dialog, "chat_id", "chat"),
    "chats.delete": (Dialog, "chat_id", "chat"),
    "chatSessions.update": (Conversation, "session_id", "session"),
    "chatSessions.delete": (Conversation, "session_id", "session"),
    "agents.update": (UserCanvas, "agent_id", "agent"),
    "agents.delete": (UserCanvas, "agent_id", "agent"),
    "agentSessions.delete": (API4Conversation, "session_id", "session"),
    "memories.update": (Memory, "memory_id", "memory"),
    "memories.delete": (Memory, "memory_id", "memory"),
    # Message state changes are serialized through their owning memory.
    "memoryMessages.update": (Memory, "memory_id", "memory"),
    "memoryMessages.delete": (Memory, "memory_id", "memory"),
}
_LOCK_ONLY_TARGETS: dict[str, tuple[Any, str, str]] = {
    "chunks.create": (Document, "document_id", "document"),
    "chunks.batchDelete": (Document, "document_id", "document"),
}


@dataclass(frozen=True)
class VersionTarget:
    resource_type: str
    resource_id: str
    version: int


@dataclass
class ConcurrencyLease:
    lock: Any
    request_id: str
    released: bool = False

    async def release(self) -> None:
        if self.released:
            return
        self.released = True
        try:
            await asyncio.to_thread(self.lock.release)
        except Exception:  # noqa: BLE001 - release failure must not replace the operation result
            logger.error("Business Gateway concurrency lock release failed request_id=%s", self.request_id)


class OptimisticConcurrencyManager:
    """Serialize public Gateway writers and enforce the latest native version."""

    def __init__(self) -> None:
        self._lock_seconds = _positive_env("NOMIX_BG_CONCURRENCY_LOCK_SECONDS", 900)
        self._blocking_seconds = _positive_env("NOMIX_BG_CONCURRENCY_WAIT_SECONDS", 2)

    async def acquire(
        self,
        capability: Capability,
        context: RagFlowExecutionContext,
        prepared: PreparedAuthorization,
        if_match: str | None,
    ) -> ConcurrencyLease | None:
        if not requires_resource_version(capability.operation):
            return None
        expected = parse_if_match(if_match, context.request_id)
        initial = version_target(capability.operation, prepared, context.request_id)
        lease = await self._acquire_lock(context, initial.resource_type, initial.resource_id)
        current = version_target(capability.operation, prepared, context.request_id)
        if current.version != expected:
            await lease.release()
            raise BusinessGatewayError(
                "VERSION_CONFLICT",
                "The resource changed; reload it and retry with its latest version.",
                status=409,
                request_id=context.request_id,
            )
        return lease

    async def acquire_recovery(
        self,
        capability: Capability,
        context: RagFlowExecutionContext,
        prepared: PreparedAuthorization,
    ) -> ConcurrencyLease | None:
        """Serialize recovery without re-evaluating the pre-effect If-Match version."""

        target = _TARGETS.get(capability.operation) or _LOCK_ONLY_TARGETS.get(capability.operation)
        if target is None:
            return None
        _, path_key, resource_type = target
        resource_id = str(prepared.path_args.get(path_key, "")).strip()
        if not resource_id:
            raise RuntimeError(f"Optimistic concurrency target {path_key} is missing for {capability.operation}")
        return await self._acquire_lock(context, resource_type, resource_id)

    async def acquire_mutation(
        self,
        capability: Capability,
        context: RagFlowExecutionContext,
        prepared: PreparedAuthorization,
    ) -> ConcurrencyLease | None:
        """Serialize mutations whose parent counter must converge but has no public ETag."""

        target = _LOCK_ONLY_TARGETS.get(capability.operation)
        if target is None:
            return None
        model, path_key, resource_type = target
        resource_id = str(prepared.path_args.get(path_key, "")).strip()
        if not resource_id or model.get_or_none(model.id == resource_id) is None:
            raise resource_not_found(context.request_id)
        return await self._acquire_lock(context, resource_type, resource_id)

    async def _acquire_lock(
        self,
        context: RagFlowExecutionContext,
        resource_type: str,
        resource_id: str,
    ) -> ConcurrencyLease:
        lock_key = _lock_key(context.tenant_id, resource_type, resource_id)
        try:
            from rag.utils.redis_conn import RedisDistributedLock

            lock = RedisDistributedLock(
                lock_key,
                timeout=self._lock_seconds,
                blocking_timeout=self._blocking_seconds,
            )
            acquired = await asyncio.to_thread(lock.acquire)
        except Exception as error:
            raise BusinessGatewayError(
                "CONCURRENCY_SERVICE_UNAVAILABLE",
                "Optimistic concurrency protection is temporarily unavailable.",
                status=503,
                request_id=context.request_id,
                retryable=True,
            ) from error
        if not acquired:
            raise BusinessGatewayError(
                "VERSION_BUSY",
                "The resource is being changed by another request; reload it before retrying.",
                status=409,
                request_id=context.request_id,
                retryable=True,
            )
        return ConcurrencyLease(lock=lock, request_id=context.request_id)


def parse_if_match(value: str | None, request_id: str | None = None) -> int:
    if value is None:
        raise BusinessGatewayError(
            "VERSION_REQUIRED",
            "If-Match with the current numeric resource version is required.",
            status=428,
            request_id=request_id,
        )
    normalized = value.strip()
    if normalized.startswith("W/"):
        normalized = normalized[2:].strip()
    if len(normalized) >= 2 and normalized[0] == normalized[-1] == '"':
        normalized = normalized[1:-1]
    if not _NUMERIC_ETAG.fullmatch(normalized):
        raise BusinessGatewayError(
            "VERSION_REQUIRED",
            "If-Match must contain one positive numeric resource version.",
            status=428,
            request_id=request_id,
        )
    return int(normalized)


def version_target(operation: str, prepared: PreparedAuthorization, request_id: str | None = None) -> VersionTarget:
    try:
        model, path_key, resource_type = _TARGETS[operation]
    except KeyError as error:
        raise RuntimeError(f"No optimistic concurrency target is registered for {operation}") from error
    resource_id = str(prepared.path_args.get(path_key, "")).strip()
    if not resource_id:
        raise RuntimeError(f"Optimistic concurrency target {path_key} is missing for {operation}")
    row = model.get_or_none(model.id == resource_id)
    if row is None:
        raise resource_not_found(request_id)
    return VersionTarget(resource_type=resource_type, resource_id=resource_id, version=native_resource_version(row))


def native_resource_version(row: Any) -> int:
    """Use RAGFlow's existing monotonic millisecond timestamps as the version."""

    raw = getattr(row, "update_time", None) or getattr(row, "create_time", None) or 1
    try:
        version = int(raw)
    except (TypeError, ValueError):
        version = 1
    return max(version, 1)


def _lock_key(tenant_id: str, resource_type: str, resource_id: str) -> str:
    digest = hashlib.sha256(f"{tenant_id}\0{resource_type}\0{resource_id}".encode()).hexdigest()
    return f"nomix:bg:version:{digest}"


def _positive_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive integer") from error
    if parsed < 1:
        raise RuntimeError(f"{name} must be a positive integer")
    return parsed


def requires_mutation_lock(operation: str) -> bool:
    return operation in _LOCK_ONLY_TARGETS
