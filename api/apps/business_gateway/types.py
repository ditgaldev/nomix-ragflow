#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

ScopeMode = Literal["all", "ids", "inherit", "none"]


@dataclass(frozen=True)
class ResourceScope:
    mode: ScopeMode
    ids: frozenset[str] = frozenset()

    @classmethod
    def none(cls) -> ResourceScope:
        return cls("none")

    def contains(self, resource_id: str) -> bool:
        return self.mode in {"all", "inherit"} or resource_id in self.ids


@dataclass(frozen=True)
class IntrospectionClaims:
    authority: str
    subject: str
    actor_subject: str
    on_behalf_of_subject: str | None
    workspace_id: str
    actions: frozenset[str]
    dataset_scope: ResourceScope
    document_scope: ResourceScope
    permission_ref: str | None
    expires_at: datetime
    audience: tuple[str, ...]
    client_id: str | None
    token_use: Literal["data"]
    chat_scope: ResourceScope = field(default_factory=ResourceScope.none)
    agent_scope: ResourceScope = field(default_factory=ResourceScope.none)
    memory_scope: ResourceScope = field(default_factory=ResourceScope.none)


@dataclass(frozen=True)
class BusinessAuthorizationContext:
    """Verified business claims supplied by the external authorization system.

    This context intentionally contains no RAGFlow tenant, execution principal,
    credential fingerprint, or transport metadata.  Those values belong to the
    service-local execution context below and cannot become authorization claims.
    """

    subject: str
    actor_subject: str
    on_behalf_of_subject: str | None
    workspace_id: str
    actions: frozenset[str]
    dataset_scope: ResourceScope
    document_scope: ResourceScope
    permission_ref: str | None
    authentication_type: Literal["token-introspection"]
    request_id: str
    authority: str
    audience: tuple[str, ...]
    expires_at: datetime
    client_id: str | None
    token_use: Literal["data"]
    chat_scope: ResourceScope = field(default_factory=ResourceScope.none)
    agent_scope: ResourceScope = field(default_factory=ResourceScope.none)
    memory_scope: ResourceScope = field(default_factory=ResourceScope.none)

    def to_public_dict(self) -> dict[str, Any]:
        """Return only externally verified claims; local execution data cannot leak."""

        return {
            "subject": self.subject,
            "actorSubject": self.actor_subject,
            "onBehalfOfSubject": self.on_behalf_of_subject,
            "workspaceId": self.workspace_id,
            "actions": sorted(self.actions),
            "datasetScope": _public_scope(self.dataset_scope),
            "documentScope": _public_scope(self.document_scope),
            "chatScope": _public_scope(self.chat_scope),
            "agentScope": _public_scope(self.agent_scope),
            "memoryScope": _public_scope(self.memory_scope),
            "permissionRef": self.permission_ref,
            "authenticationType": self.authentication_type,
            "requestId": self.request_id,
            "tokenUse": self.token_use,
            "audience": list(self.audience),
            "expiresAt": self.expires_at.isoformat().replace("+00:00", "Z"),
            "clientId": self.client_id,
        }


@dataclass(frozen=True)
class RagFlowExecutionContext:
    """RAGFlow-local execution data wrapped around verified business claims."""

    authorization: BusinessAuthorizationContext
    tenant_id: str
    execution_user_id: str
    workspace_binding_id: str
    token_fingerprint: str
    entry_point: Literal["rest", "agent"]

    @property
    def subject(self) -> str:
        return self.authorization.subject

    @property
    def actor_subject(self) -> str:
        return self.authorization.actor_subject

    @property
    def on_behalf_of_subject(self) -> str | None:
        return self.authorization.on_behalf_of_subject

    @property
    def workspace_id(self) -> str:
        return self.authorization.workspace_id

    @property
    def actions(self) -> frozenset[str]:
        return self.authorization.actions

    @property
    def dataset_scope(self) -> ResourceScope:
        return self.authorization.dataset_scope

    @property
    def document_scope(self) -> ResourceScope:
        return self.authorization.document_scope

    @property
    def chat_scope(self) -> ResourceScope:
        return self.authorization.chat_scope

    @property
    def agent_scope(self) -> ResourceScope:
        return self.authorization.agent_scope

    @property
    def memory_scope(self) -> ResourceScope:
        return self.authorization.memory_scope

    @property
    def permission_ref(self) -> str | None:
        return self.authorization.permission_ref

    @property
    def authentication_type(self) -> Literal["token-introspection"]:
        return self.authorization.authentication_type

    @property
    def request_id(self) -> str:
        return self.authorization.request_id

    @property
    def authority(self) -> str:
        return self.authorization.authority

    @property
    def audience(self) -> tuple[str, ...]:
        return self.authorization.audience

    @property
    def expires_at(self) -> datetime:
        return self.authorization.expires_at

    @property
    def client_id(self) -> str | None:
        return self.authorization.client_id

    @property
    def token_use(self) -> Literal["data"]:
        return self.authorization.token_use


@dataclass(frozen=True)
class AuthorizationSeal:
    operation: str
    scope_domain: str
    visibility: str
    workspace_binding_id: str
    tenant_id: str
    subject: str
    scope_hash: str
    request_hash: str


@dataclass
class PreparedAuthorization:
    payload: dict[str, Any] | None
    query: dict[str, Any]
    path_args: dict[str, Any]
    dataset_ids: frozenset[str] = frozenset()
    document_ids: frozenset[str] = frozenset()
    chat_ids: frozenset[str] = frozenset()
    agent_ids: frozenset[str] = frozenset()
    memory_ids: frozenset[str] = frozenset()
    empty_result: Any = None
    has_empty_result: bool = False
    created_resource_types: set[str] = field(default_factory=set)
    authorization_seal: AuthorizationSeal | None = None
    execution_command_id: str | None = None


def _public_scope(scope: ResourceScope) -> dict[str, Any]:
    result: dict[str, Any] = {"mode": scope.mode}
    if scope.mode == "ids":
        result["ids"] = sorted(scope.ids)
    return result
