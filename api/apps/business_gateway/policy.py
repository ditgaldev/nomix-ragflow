#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from api.db.db_models import (
    API4Conversation,
    Conversation,
    Dialog,
    Document,
    Knowledgebase,
    Memory,
    UserCanvas,
)
from api.db.services.document_service import DocumentService
from api.db.services.knowledgebase_service import KnowledgebaseService
from common.constants import StatusEnum

from .agent_capabilities import analyze_agent_dsl
from .capabilities import Capability
from .errors import BusinessGatewayError, resource_not_found
from .recovery import RecoveryPlan
from .scope_registry import issue_authorization_seal
from .types import PreparedAuthorization, RagFlowExecutionContext, ResourceScope

MAX_EXPLICIT_IDS = 1_000
_FORBIDDEN_CONTEXT_FIELDS = frozenset(
    {
        "tenant",
        "tenantId",
        "tenant_id",
        "workspace",
        "workspaceId",
        "workspace_id",
        "subject",
        "userId",
        "user_id",
        "actorSubject",
        "actor_subject",
        "onBehalfOfSubject",
        "on_behalf_of_subject",
        "actions",
        "scope",
        "dataScope",
        "data_scope",
        "datasetScope",
        "dataset_scope",
        "documentScope",
        "document_scope",
        "chatScope",
        "chat_scope",
        "agentScope",
        "agent_scope",
        "memoryScope",
        "memory_scope",
        "permissionRef",
        "permission_ref",
        "authenticationType",
        "authentication_type",
        "authorization",
        "accessToken",
        "access_token",
        "apiKey",
        "api_key",
        "clientSecret",
        "client_secret",
        "ownerIds",
        "owner_ids",
    }
)
_LEGACY_WIRE_FIELDS = frozenset(
    {
        "dataset_ids",
        "document_ids",
        "chunk_ids",
        "memory_ids",
        "kb_ids",
        "page",
        "pageSize",
        "page_size",
        "deleteAll",
        "delete_all",
    }
)
_SERVER_OWNED_RESOURCE_FIELDS = frozenset({"permission", "permissions"})


class AuthorizationPolicy:
    def __init__(self, context: RagFlowExecutionContext) -> None:
        self.context = context
        self._dataset_ids: frozenset[str] | None = None
        self._document_ids: frozenset[str] | None = None
        self._chat_ids: frozenset[str] | None = None
        self._agent_ids: frozenset[str] | None = None
        self._memory_ids: frozenset[str] | None = None

    def require_actions(self, capability: Capability) -> None:
        self.require_action_names(capability.required_actions)

    def require_action_names(self, required_actions: Iterable[str]) -> None:
        required = frozenset(required_actions)
        missing = sorted(required - self.context.actions)
        if missing:
            raise BusinessGatewayError(
                "ACTION_NOT_ALLOWED",
                "The business subject is not allowed to perform this action.",
                status=403,
                request_id=self.context.request_id,
                details={"requiredActions": sorted(required)},
            )

    def prepare(
        self,
        capability: Capability,
        path_args: dict[str, Any],
        payload: dict[str, Any] | None,
        query: dict[str, Any],
    ) -> PreparedAuthorization:
        self.require_actions(capability)
        if payload is not None:
            self._reject_server_owned_resource_fields(payload)
            self._reject_context_fields(payload)
            self._reject_legacy_wire_fields(payload, "body")
        self._reject_context_fields(query, "query")
        self._reject_legacy_wire_fields(query, "query")

        prepared = PreparedAuthorization(
            payload=dict(payload) if payload is not None else None,
            query=dict(query),
            path_args=dict(path_args),
        )
        explicit_datasets = self._explicit_dataset_ids(capability.operation, path_args, payload, query)
        explicit_documents = self._explicit_document_ids(capability.operation, path_args, payload, query)
        explicit_chats = self._explicit_chat_ids(capability.operation, path_args, payload, query)
        explicit_agents = self._explicit_agent_ids(capability.operation, path_args)
        explicit_memories = self._explicit_memory_ids(capability.operation, path_args, payload, query)

        if explicit_datasets:
            self._require_dataset_ids(explicit_datasets)
            prepared.dataset_ids = frozenset(explicit_datasets)
        if explicit_documents:
            self._require_document_ids(explicit_documents, explicit_datasets or None)
            prepared.document_ids = frozenset(explicit_documents)
        if explicit_chats:
            self._require_chat_ids(explicit_chats)
            prepared.chat_ids = frozenset(explicit_chats)
        if explicit_agents:
            self._require_agent_ids(explicit_agents)
            prepared.agent_ids = frozenset(explicit_agents)
        if explicit_memories:
            self._require_memory_ids(explicit_memories)
            prepared.memory_ids = frozenset(explicit_memories)

        self._require_tenant_resources(capability.operation, path_args, payload, query)

        operation = capability.operation
        if operation == "retrieval.search":
            if not explicit_datasets:
                allowed = self.dataset_ids()
                if not allowed:
                    prepared.has_empty_result = True
                    prepared.empty_result = {"chunks": [], "total": 0, "docAggs": {}}
                else:
                    assert prepared.payload is not None
                    prepared.payload["datasetIds"] = sorted(allowed)
                    prepared.dataset_ids = allowed
            if not explicit_documents and self.context.document_scope.mode == "ids":
                allowed_documents = self.document_ids_for_datasets(prepared.dataset_ids)
                if not allowed_documents:
                    prepared.has_empty_result = True
                    prepared.empty_result = {"chunks": [], "total": 0, "docAggs": {}}
                else:
                    assert prepared.payload is not None
                    prepared.payload["documentIds"] = sorted(allowed_documents)
                    prepared.document_ids = allowed_documents

        if operation == "datasets.list" and not explicit_datasets:
            allowed = self.dataset_ids()
            if not allowed:
                prepared.has_empty_result = True
                prepared.empty_result = []
            else:
                prepared.query["ids"] = sorted(allowed)
                prepared.dataset_ids = allowed

        if operation == "documents.list" and self.context.document_scope.mode == "ids" and not explicit_documents:
            dataset_id = str(path_args["dataset_id"])
            allowed = self.document_ids_for_datasets(frozenset({dataset_id}))
            if not allowed:
                prepared.has_empty_result = True
                prepared.empty_result = {"documents": []}
            else:
                prepared.query["ids"] = sorted(allowed)
                prepared.document_ids = allowed

        for list_operation, allowed in (
            ("chats.list", self.chat_ids),
            ("agents.list", self.agent_ids),
            ("memories.list", self.memory_ids),
        ):
            if operation == list_operation:
                resource_ids = allowed()
                if not resource_ids:
                    prepared.has_empty_result = True
                    prepared.empty_result = []
                elif list_operation == "chats.list":
                    prepared.chat_ids = resource_ids
                elif list_operation == "agents.list":
                    prepared.agent_ids = resource_ids
                else:
                    prepared.memory_ids = resource_ids

        if operation in {"datasets.batchDelete", "documents.batchDelete", "chunks.batchDelete", "chats.batchDelete", "chatSessions.batchDelete", "agentSessions.batchDelete"}:
            ids = self._body_ids(payload, "ids")
            if not ids:
                raise BusinessGatewayError(
                    "INVALID_REQUEST",
                    "A non-empty explicit ids array is required.",
                    status=400,
                    request_id=self.context.request_id,
                )

        if operation in {"documents.startParse", "documents.cancelParse"}:
            ids = self._body_ids(payload, "documentIds")
            if not ids:
                raise BusinessGatewayError(
                    "INVALID_REQUEST",
                    "A non-empty documentIds array is required.",
                    status=400,
                    request_id=self.context.request_id,
                )
            self._require_document_ids(ids, explicit_datasets or None)
            prepared.document_ids = frozenset(ids)

        self._seal_authorization(capability.operation, prepared)
        return prepared

    def prepare_recovery(
        self,
        capability: Capability,
        path_args: dict[str, Any],
        payload: dict[str, Any] | None,
        query: dict[str, Any],
        plan: RecoveryPlan,
    ) -> PreparedAuthorization:
        """Authorize completion of an exact prior command after its target disappeared."""

        self.require_actions(capability)
        if payload is not None:
            self._reject_server_owned_resource_fields(payload)
            self._reject_context_fields(payload)
            self._reject_legacy_wire_fields(payload, "body")
        self._reject_context_fields(query, "query")
        self._reject_legacy_wire_fields(query, "query")

        descriptor = plan.descriptor
        prepared = PreparedAuthorization(
            payload=dict(payload) if payload is not None else None,
            query=dict(query),
            path_args=dict(path_args),
        )
        dataset_ids = {str(value) for value in (descriptor.get("datasetId"), *(item.get("id") for item in descriptor.get("datasets", []) if isinstance(item, dict))) if value}
        dataset_ids.update(str(item["datasetId"]) for item in descriptor.get("documents", []) if isinstance(item, dict) and item.get("datasetId"))
        document_ids = {str(value) for value in (descriptor.get("documentId"), *(item.get("id") for item in descriptor.get("documents", []) if isinstance(item, dict))) if value}
        ids = frozenset(str(value) for value in descriptor.get("ids", []) if value)
        prefix = capability.operation.partition(".")[0]
        prepared.dataset_ids = frozenset(dataset_ids)
        prepared.document_ids = frozenset(document_ids)
        if prefix == "chats":
            prepared.chat_ids = ids
        elif prefix == "agents":
            prepared.agent_ids = ids

        self._require_recovery_scope(self.context.dataset_scope, prepared.dataset_ids)
        if self.context.document_scope.mode != "inherit":
            self._require_recovery_scope(self.context.document_scope, prepared.document_ids)
        if prepared.chat_ids:
            self._require_recovery_scope(self.context.chat_scope, prepared.chat_ids)
        if prepared.agent_ids:
            self._require_recovery_scope(self.context.agent_scope, prepared.agent_ids)

        existing_datasets = frozenset(str(row.id) for row in Knowledgebase.select(Knowledgebase.id).where(Knowledgebase.id.in_(prepared.dataset_ids)))
        if existing_datasets and not existing_datasets.issubset(self.dataset_ids()):
            raise resource_not_found(self.context.request_id)
        self._seal_authorization(capability.operation, prepared)
        return prepared

    def _require_recovery_scope(self, scope: ResourceScope, resource_ids: frozenset[str]) -> None:
        if resource_ids and not all(scope.contains(resource_id) for resource_id in resource_ids):
            raise resource_not_found(self.context.request_id)

    def _seal_authorization(self, operation: str, prepared: PreparedAuthorization) -> None:
        allowed_datasets = prepared.dataset_ids
        allowed_documents = prepared.document_ids
        if operation in {"retrieval.search", "datasets.list", "documents.list"}:
            allowed_datasets = self.dataset_ids()
        if operation in {"retrieval.search", "documents.list"} and self.context.document_scope.mode == "ids":
            allowed_documents = self.document_ids()
        allowed_chats = self.chat_ids() if operation == "chats.list" else prepared.chat_ids
        allowed_agents = self.agent_ids() if operation == "agents.list" else prepared.agent_ids
        allowed_memories = self.memory_ids() if operation == "memories.list" else prepared.memory_ids
        prepared.authorization_seal = issue_authorization_seal(
            operation,
            self.context,
            prepared,
            allowed_dataset_ids=allowed_datasets,
            allowed_document_ids=allowed_documents,
            allowed_chat_ids=allowed_chats,
            allowed_agent_ids=allowed_agents,
            allowed_memory_ids=allowed_memories,
        )

    def dataset_ids(self) -> frozenset[str]:
        if self._dataset_ids is not None:
            return self._dataset_ids
        scope = self.context.dataset_scope
        if scope.mode == "none":
            candidates: Iterable[str] = ()
        elif scope.mode == "ids":
            candidates = scope.ids
        else:
            candidates = (row.id for row in Knowledgebase.select(Knowledgebase.id).where((Knowledgebase.tenant_id == self.context.tenant_id) & (Knowledgebase.status == StatusEnum.VALID.value)))
        allowed: set[str] = set()
        for dataset_id in candidates:
            kb = Knowledgebase.get_or_none(Knowledgebase.id == dataset_id)
            if kb is None or kb.tenant_id != self.context.tenant_id or kb.status != StatusEnum.VALID.value:
                continue
            if KnowledgebaseService.accessible(dataset_id, self.context.execution_user_id):
                allowed.add(dataset_id)
        self._dataset_ids = frozenset(allowed)
        return self._dataset_ids

    def document_ids(self) -> frozenset[str]:
        if self._document_ids is not None:
            return self._document_ids
        dataset_ids = self.dataset_ids()
        if not dataset_ids:
            self._document_ids = frozenset()
            return self._document_ids
        scope = self.context.document_scope
        if scope.mode == "none":
            candidates: Iterable[str] = ()
        elif scope.mode == "ids":
            candidates = scope.ids
        else:
            candidates = (row.id for row in Document.select(Document.id).where((Document.kb_id.in_(dataset_ids)) & (Document.status == StatusEnum.VALID.value)))
        allowed: set[str] = set()
        for document_id in candidates:
            doc = Document.get_or_none(Document.id == document_id)
            if doc is None or doc.kb_id not in dataset_ids or doc.status != StatusEnum.VALID.value:
                continue
            if DocumentService.accessible(document_id, self.context.execution_user_id):
                allowed.add(document_id)
        self._document_ids = frozenset(allowed)
        return self._document_ids

    def document_ids_for_datasets(self, dataset_ids: frozenset[str]) -> frozenset[str]:
        return frozenset(document_id for document_id in self.document_ids() if (doc := Document.get_or_none(Document.id == document_id)) is not None and doc.kb_id in dataset_ids)

    def chat_ids(self) -> frozenset[str]:
        if self._chat_ids is not None:
            return self._chat_ids
        scope = self.context.chat_scope
        if scope.mode == "none":
            rows: Iterable[Any] = ()
        else:
            condition = (Dialog.tenant_id == self.context.tenant_id) & (Dialog.status == StatusEnum.VALID.value)
            if scope.mode == "ids":
                condition &= Dialog.id.in_(scope.ids)
            rows = Dialog.select(Dialog.id, Dialog.kb_ids).where(condition)
        allowed: set[str] = set()
        allowed_datasets = self.dataset_ids()
        for row in rows:
            try:
                references = set(_embedded_dataset_ids({"kbIds": row.kb_ids}))
            except ValueError:
                continue
            if references.issubset(allowed_datasets):
                allowed.add(str(row.id))
        self._chat_ids = frozenset(allowed)
        return self._chat_ids

    def agent_ids(self) -> frozenset[str]:
        if self._agent_ids is not None:
            return self._agent_ids
        scope = self.context.agent_scope
        if scope.mode == "none":
            rows: Iterable[Any] = ()
        else:
            condition = (UserCanvas.user_id == self.context.tenant_id) & (UserCanvas.canvas_category == "agent_canvas")
            if scope.mode == "ids":
                condition &= UserCanvas.id.in_(scope.ids)
            rows = UserCanvas.select(UserCanvas.id, UserCanvas.dsl).where(condition)
        allowed: set[str] = set()
        allowed_datasets = self.dataset_ids()
        for row in rows:
            try:
                references = set(_embedded_dataset_ids(row.dsl))
            except ValueError:
                continue
            if references.issubset(allowed_datasets):
                allowed.add(str(row.id))
        self._agent_ids = frozenset(allowed)
        return self._agent_ids

    def memory_ids(self) -> frozenset[str]:
        if self._memory_ids is not None:
            return self._memory_ids
        scope = self.context.memory_scope
        if scope.mode == "none":
            rows: Iterable[Any] = ()
        else:
            condition = Memory.tenant_id == self.context.tenant_id
            if scope.mode == "ids":
                condition &= Memory.id.in_(scope.ids)
            rows = Memory.select(Memory.id).where(condition)
        self._memory_ids = frozenset(str(row.id) for row in rows)
        return self._memory_ids

    def _require_dataset_ids(self, dataset_ids: list[str]) -> None:
        if not set(dataset_ids).issubset(self.dataset_ids()):
            raise resource_not_found(self.context.request_id)

    def _require_document_ids(self, document_ids: list[str], dataset_ids: list[str] | None) -> None:
        allowed = self.document_ids()
        if not set(document_ids).issubset(allowed):
            raise resource_not_found(self.context.request_id)
        if dataset_ids:
            parents = {row.kb_id for row in Document.select(Document.kb_id).where(Document.id.in_(document_ids))}
            if not parents.issubset(set(dataset_ids)):
                raise resource_not_found(self.context.request_id)

    def _require_chat_ids(self, chat_ids: list[str]) -> None:
        if not set(chat_ids).issubset(self.chat_ids()):
            raise resource_not_found(self.context.request_id)

    def _require_agent_ids(self, agent_ids: list[str]) -> None:
        if not set(agent_ids).issubset(self.agent_ids()):
            raise resource_not_found(self.context.request_id)

    def _require_memory_ids(self, memory_ids: list[str]) -> None:
        if not set(memory_ids).issubset(self.memory_ids()):
            raise resource_not_found(self.context.request_id)

    def _require_tenant_resources(
        self,
        operation: str,
        path_args: dict[str, Any],
        payload: dict[str, Any] | None,
        query: dict[str, Any],
    ) -> None:
        if operation.startswith(("chats.", "chatSessions.")):
            ids = [str(path_args["chat_id"])] if path_args.get("chat_id") else []
            if operation == "chats.batchDelete":
                ids.extend(self._body_ids(payload, "ids"))
            for resource_id in _validated_ids(ids, self.context.request_id):
                row = Dialog.get_or_none(Dialog.id == resource_id)
                if row is None or row.tenant_id != self.context.tenant_id:
                    raise resource_not_found(self.context.request_id)
                # Dialog.kb_ids is stored as a bare ID list rather than under a
                # wire-level kbIds field.  Wrap it so the same fail-closed
                # dataset reference parser is used for persisted chat config.
                references = self._require_embedded_dataset_ids({"kbIds": row.kb_ids})
                if operation == "chatSessions.invoke" and references:
                    self.require_action_names({"knowledge:retrieve"})

            if operation.startswith("chatSessions."):
                session_ids = [str(path_args["session_id"])] if path_args.get("session_id") else []
                session_ids.extend(self._body_ids(payload, "ids"))
                session_ids.extend(self._query_ids(query, "id"))
                chat_id = path_args.get("chat_id")
                for session_id in _validated_ids(session_ids, self.context.request_id):
                    row = Conversation.get_or_none(Conversation.id == session_id)
                    if row is None or str(row.dialog_id) != str(chat_id) or str(row.user_id) != self.context.subject:
                        raise resource_not_found(self.context.request_id)

        if operation.startswith(("agents.", "agentSessions.")):
            ids = [str(path_args["agent_id"])] if path_args.get("agent_id") else []
            for resource_id in _validated_ids(ids, self.context.request_id):
                row = UserCanvas.get_or_none(UserCanvas.id == resource_id)
                if row is None or row.user_id != self.context.tenant_id or str(row.canvas_category) != "agent_canvas":
                    raise resource_not_found(self.context.request_id)
                self._require_embedded_dataset_ids(row.dsl)

            if operation.startswith("agentSessions."):
                session_ids = [str(path_args["session_id"])] if path_args.get("session_id") else []
                session_ids.extend(self._body_ids(payload, "ids"))
                session_ids.extend(self._query_ids(query, "id"))
                agent_id = path_args.get("agent_id")
                for session_id in _validated_ids(session_ids, self.context.request_id):
                    row = API4Conversation.get_or_none(API4Conversation.id == session_id)
                    if row is None or str(row.dialog_id) != str(agent_id) or str(row.user_id) != self.context.subject:
                        raise resource_not_found(self.context.request_id)
                    self._require_embedded_dataset_ids(row.dsl)
                    if operation == "agentSessions.invoke":
                        analysis = analyze_agent_dsl(row.dsl, self.context.request_id)
                        self.require_action_names(analysis.required_actions)

        if operation.startswith(("memories.", "memoryMessages.")):
            ids = [str(path_args["memory_id"])] if path_args.get("memory_id") else []
            ids.extend(self._body_ids(payload, "memoryIds"))
            ids.extend(self._query_ids(query, "memoryIds"))
            for resource_id in _validated_ids(ids, self.context.request_id):
                row = Memory.get_or_none(Memory.id == resource_id)
                if row is None or row.tenant_id != self.context.tenant_id:
                    raise resource_not_found(self.context.request_id)

        if operation.startswith("chunks."):
            chunk_ids = [str(path_args["chunk_id"])] if path_args.get("chunk_id") else []
            chunk_ids.extend(self._body_ids(payload, "ids"))
            chunk_ids.extend(self._query_ids(query, "id"))
            if chunk_ids:
                self._require_chunk_ids(
                    _validated_ids(chunk_ids, self.context.request_id),
                    str(path_args.get("dataset_id", "")),
                    str(path_args.get("document_id", "")),
                )

    def _explicit_dataset_ids(
        self,
        operation: str,
        path_args: dict[str, Any],
        payload: dict[str, Any] | None,
        query: dict[str, Any],
    ) -> list[str]:
        result: list[str] = []
        if path_args.get("dataset_id"):
            result.append(str(path_args["dataset_id"]))
        result.extend(_embedded_dataset_ids(payload, self.context.request_id))
        result.extend(self._query_ids(query, "datasetIds"))
        if operation.startswith("datasets."):
            result.extend(self._body_ids(payload, "ids"))
            result.extend(self._query_ids(query, "ids"))
            if query.get("id"):
                result.append(str(query["id"]))
        return _validated_ids(result, self.context.request_id)

    def _explicit_document_ids(
        self,
        operation: str,
        path_args: dict[str, Any],
        payload: dict[str, Any] | None,
        query: dict[str, Any],
    ) -> list[str]:
        result: list[str] = []
        if path_args.get("document_id"):
            result.append(str(path_args["document_id"]))
        result.extend(self._body_ids(payload, "documentIds"))
        result.extend(self._query_ids(query, "documentIds"))
        if operation.startswith("documents."):
            result.extend(self._body_ids(payload, "ids"))
            result.extend(self._query_ids(query, "ids"))
            if query.get("id"):
                result.append(str(query["id"]))
        return _validated_ids(result, self.context.request_id)

    def _explicit_chat_ids(
        self,
        operation: str,
        path_args: dict[str, Any],
        payload: dict[str, Any] | None,
        query: dict[str, Any],
    ) -> list[str]:
        result = [str(path_args["chat_id"])] if path_args.get("chat_id") else []
        if operation == "chats.batchDelete":
            result.extend(self._body_ids(payload, "ids"))
        if operation == "chats.list" and query.get("id"):
            result.extend(self._query_ids(query, "id"))
        return _validated_ids(result, self.context.request_id)

    def _explicit_agent_ids(self, operation: str, path_args: dict[str, Any]) -> list[str]:
        del operation
        result = [str(path_args["agent_id"])] if path_args.get("agent_id") else []
        return _validated_ids(result, self.context.request_id)

    def _explicit_memory_ids(
        self,
        operation: str,
        path_args: dict[str, Any],
        payload: dict[str, Any] | None,
        query: dict[str, Any],
    ) -> list[str]:
        del operation
        result = [str(path_args["memory_id"])] if path_args.get("memory_id") else []
        result.extend(self._body_ids(payload, "memoryIds"))
        result.extend(self._query_ids(query, "memoryIds"))
        return _validated_ids(result, self.context.request_id)

    def _body_ids(self, payload: dict[str, Any] | None, key: str) -> list[str]:
        if not payload or key not in payload:
            return []
        value = payload[key]
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise BusinessGatewayError(
                "INVALID_REQUEST",
                f"{key} must be an array of resource ID strings.",
                status=400,
                request_id=self.context.request_id,
            )
        return value

    def _query_ids(self, query: dict[str, Any], key: str) -> list[str]:
        value = query.get(key)
        if value is None:
            return []
        if isinstance(value, list):
            if any(not isinstance(item, str) for item in value):
                raise BusinessGatewayError(
                    "INVALID_REQUEST",
                    f"{key} must contain resource ID strings.",
                    status=400,
                    request_id=self.context.request_id,
                )
            return value
        if not isinstance(value, str):
            raise BusinessGatewayError(
                "INVALID_REQUEST",
                f"{key} must contain resource ID strings.",
                status=400,
                request_id=self.context.request_id,
            )
        return [value]

    def _require_chunk_ids(self, chunk_ids: list[str], dataset_id: str, document_id: str) -> None:
        try:
            from common import settings
            from rag.nlp import search

            index_name = search.index_name(self.context.tenant_id)
            for chunk_id in chunk_ids:
                chunk = settings.docStoreConn.get(chunk_id, index_name, [dataset_id])
                parent_id = None if chunk is None else chunk.get("doc_id", chunk.get("document_id"))
                if chunk is None or str(parent_id) != document_id or chunk.get("compile_kwd"):
                    raise resource_not_found(self.context.request_id)
        except BusinessGatewayError:
            raise
        except Exception as error:
            raise BusinessGatewayError(
                "RAGFLOW_SERVICE_UNAVAILABLE",
                "The RAGFlow document store is temporarily unavailable.",
                status=503,
                request_id=self.context.request_id,
                retryable=True,
            ) from error

    def _require_embedded_dataset_ids(self, value: Any) -> frozenset[str]:
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError as error:
                raise resource_not_found(self.context.request_id) from error
        try:
            references = _embedded_dataset_ids(value)
        except ValueError as error:
            raise resource_not_found(self.context.request_id) from error
        if references and not set(references).issubset(self.dataset_ids()):
            raise resource_not_found(self.context.request_id)
        return frozenset(references)

    def _reject_legacy_wire_fields(self, value: dict[str, Any], path: str) -> None:
        forbidden = sorted(str(key) for key in value if key in _LEGACY_WIRE_FIELDS)
        if forbidden:
            raise BusinessGatewayError(
                "INVALID_REQUEST",
                "Business Gateway requests must use the v1 camelCase schema.",
                status=400,
                request_id=self.context.request_id,
                details={"fields": forbidden, "path": path},
            )

    def _reject_server_owned_resource_fields(self, value: dict[str, Any]) -> None:
        forbidden = sorted(str(key) for key in value if key in _SERVER_OWNED_RESOURCE_FIELDS)
        if forbidden:
            raise BusinessGatewayError(
                "UNTRUSTED_AUTHORIZATION_CONTEXT",
                "Server-owned resource access-control fields are not accepted.",
                status=400,
                request_id=self.context.request_id,
                details={"fields": forbidden, "path": "body"},
            )

    def _reject_context_fields(self, value: Any, path: str = "body") -> None:
        if isinstance(value, dict):
            forbidden = sorted(str(key) for key in value if key in _FORBIDDEN_CONTEXT_FIELDS)
            if forbidden:
                raise BusinessGatewayError(
                    "UNTRUSTED_AUTHORIZATION_CONTEXT",
                    "Authorization context fields are not accepted in request bodies.",
                    status=400,
                    request_id=self.context.request_id,
                    details={"fields": forbidden, "path": path},
                )
            for key, member in value.items():
                self._reject_context_fields(member, f"{path}.{key}")
        elif isinstance(value, list):
            for index, member in enumerate(value):
                self._reject_context_fields(member, f"{path}[{index}]")


def _validated_ids(values: list[str], request_id: str | None) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = raw.strip()
        if not value:
            raise BusinessGatewayError(
                "INVALID_REQUEST",
                "Resource IDs must be non-empty strings.",
                status=400,
                request_id=request_id,
            )
        if value not in seen:
            seen.add(value)
            result.append(value)
    if len(result) > MAX_EXPLICIT_IDS:
        raise BusinessGatewayError(
            "INVALID_REQUEST",
            f"At most {MAX_EXPLICIT_IDS} resource IDs are accepted per request.",
            status=400,
            request_id=request_id,
        )
    return result


_DATASET_REFERENCE_KEYS = frozenset({"datasetids", "kbids"})


def _embedded_dataset_ids(value: Any, request_id: str | None = None) -> list[str]:
    """Collect dataset references from chat payloads and nested Agent DSL."""

    result: list[str] = []

    def visit(member: Any) -> None:
        if isinstance(member, dict):
            for key, nested in member.items():
                normalized = str(key).replace("_", "").lower()
                if normalized in _DATASET_REFERENCE_KEYS:
                    if nested is None:
                        continue
                    if not isinstance(nested, list) or any(not isinstance(item, str) for item in nested):
                        if request_id is None:
                            raise ValueError("stored dataset references are invalid")
                        raise BusinessGatewayError(
                            "INVALID_REQUEST",
                            f"{key} must be an array of dataset ID strings.",
                            status=400,
                            request_id=request_id,
                        )
                    result.extend(nested)
                else:
                    visit(nested)
        elif isinstance(member, list):
            for nested in member:
                visit(nested)

    visit(value)
    if request_id is not None:
        return _validated_ids(result, request_id)
    normalized = [item.strip() for item in result]
    if len(normalized) > MAX_EXPLICIT_IDS or any(not item for item in normalized):
        raise ValueError("stored dataset references are invalid")
    return list(dict.fromkeys(normalized))
