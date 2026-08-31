#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Mandatory scope boundary and authorization seals for Gateway operations."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Literal

from .capabilities import capabilities
from .errors import BusinessGatewayError
from .types import AuthorizationSeal, PreparedAuthorization, RagFlowExecutionContext

ScopeDomain = Literal["authorization", "knowledge", "dataset", "document", "chunk", "chat", "session", "agent", "memory", "memory-message"]
Visibility = Literal["tenant-acl", "tenant", "subject"]


@dataclass(frozen=True)
class ScopeRule:
    domain: ScopeDomain
    visibility: Visibility


_PREFIX_RULES: dict[str, ScopeRule] = {
    "authorization": ScopeRule("authorization", "subject"),
    "retrieval": ScopeRule("knowledge", "tenant-acl"),
    "datasets": ScopeRule("dataset", "tenant-acl"),
    "documents": ScopeRule("document", "tenant-acl"),
    "chunks": ScopeRule("chunk", "tenant-acl"),
    "chats": ScopeRule("chat", "tenant-acl"),
    "chatSessions": ScopeRule("session", "subject"),
    "agents": ScopeRule("agent", "tenant-acl"),
    "agentSessions": ScopeRule("session", "subject"),
    "memories": ScopeRule("memory", "tenant-acl"),
    "memoryMessages": ScopeRule("memory-message", "subject"),
}


def _build_registry() -> dict[str, ScopeRule]:
    result: dict[str, ScopeRule] = {}
    for capability in capabilities():
        prefix = capability.operation.split(".", 1)[0]
        rule = _PREFIX_RULES.get(prefix)
        if rule is None:
            raise RuntimeError(f"Business Gateway operation lacks a scope rule: {capability.operation}")
        result[capability.operation] = rule
    return result


SCOPE_RULES = _build_registry()


def scope_rule(operation: str) -> ScopeRule:
    try:
        return SCOPE_RULES[operation]
    except KeyError as error:
        raise RuntimeError(f"Business Gateway operation lacks a scope rule: {operation}") from error


def issue_authorization_seal(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
    *,
    allowed_dataset_ids: frozenset[str],
    allowed_document_ids: frozenset[str],
    allowed_chat_ids: frozenset[str] = frozenset(),
    allowed_agent_ids: frozenset[str] = frozenset(),
    allowed_memory_ids: frozenset[str] = frozenset(),
) -> AuthorizationSeal:
    rule = scope_rule(operation)
    scope_hash = _scope_hash(
        context,
        rule,
        allowed_dataset_ids,
        allowed_document_ids,
        allowed_chat_ids,
        allowed_agent_ids,
        allowed_memory_ids,
    )
    request_hash = _request_hash(prepared)
    return AuthorizationSeal(
        operation=operation,
        scope_domain=rule.domain,
        visibility=rule.visibility,
        workspace_binding_id=context.workspace_binding_id,
        tenant_id=context.tenant_id,
        subject=context.subject,
        scope_hash=scope_hash,
        request_hash=request_hash,
    )


def verify_authorization_seal(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AuthorizationSeal:
    seal = prepared.authorization_seal
    rule = scope_rule(operation)
    if (
        seal is None
        or seal.operation != operation
        or seal.scope_domain != rule.domain
        or seal.visibility != rule.visibility
        or seal.workspace_binding_id != context.workspace_binding_id
        or seal.tenant_id != context.tenant_id
        or seal.subject != context.subject
        or seal.request_hash != _request_hash(prepared)
    ):
        raise BusinessGatewayError(
            "AUTHORIZATION_BOUNDARY_FAILURE",
            "The Business Gateway authorization boundary could not be verified.",
            status=500,
            request_id=context.request_id,
            retryable=False,
        )
    return seal


def _scope_hash(
    context: RagFlowExecutionContext,
    rule: ScopeRule,
    allowed_dataset_ids: frozenset[str],
    allowed_document_ids: frozenset[str],
    allowed_chat_ids: frozenset[str],
    allowed_agent_ids: frozenset[str],
    allowed_memory_ids: frozenset[str],
) -> str:
    value = {
        "domain": rule.domain,
        "visibility": rule.visibility,
        "workspaceBindingId": context.workspace_binding_id,
        "tenantId": context.tenant_id,
        "executionUserId": context.execution_user_id,
        "subject": context.subject if rule.visibility == "subject" else None,
        "permissionRef": context.permission_ref,
        "datasetScope": {"mode": context.dataset_scope.mode, "ids": sorted(context.dataset_scope.ids)},
        "documentScope": {"mode": context.document_scope.mode, "ids": sorted(context.document_scope.ids)},
        "chatScope": {"mode": context.chat_scope.mode, "ids": sorted(context.chat_scope.ids)},
        "agentScope": {"mode": context.agent_scope.mode, "ids": sorted(context.agent_scope.ids)},
        "memoryScope": {"mode": context.memory_scope.mode, "ids": sorted(context.memory_scope.ids)},
        "allowedDatasetIds": sorted(allowed_dataset_ids),
        "allowedDocumentIds": sorted(allowed_document_ids),
        "allowedChatIds": sorted(allowed_chat_ids),
        "allowedAgentIds": sorted(allowed_agent_ids),
        "allowedMemoryIds": sorted(allowed_memory_ids),
    }
    return _hash(value)


def _request_hash(prepared: PreparedAuthorization) -> str:
    return _hash(
        {
            "path": prepared.path_args,
            "query": prepared.query,
            "payload": prepared.payload,
            "datasetIds": sorted(prepared.dataset_ids),
            "documentIds": sorted(prepared.document_ids),
            "chatIds": sorted(prepared.chat_ids),
            "agentIds": sorted(prepared.agent_ids),
            "memoryIds": sorted(prepared.memory_ids),
            "empty": prepared.has_empty_result,
        }
    )


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
