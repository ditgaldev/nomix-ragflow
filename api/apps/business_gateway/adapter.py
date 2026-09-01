#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from typing import Any

import xxhash
from quart import Response, current_app, g, request, send_file

from api.apps.services import dataset_api_service, memory_api_service
from api.apps.services.document_api_service import reset_document_for_reparse, update_chunk_method, update_document_name_only, update_document_status_only
from api.db.db_models import API4Conversation, Conversation, Dialog, Document, Knowledgebase, Memory, Task, Tenant, UserCanvas, UserTenant
from api.db.joint_services.tenant_model_service import get_tenant_default_model_by_type, resolve_model_config
from api.db.services import UserService
from api.db.services.canvas_service import UserCanvasService
from api.db.services.canvas_service import completion as agent_completion
from api.db.services.conversation_service import ConversationService, structure_answer
from api.db.services.dialog_service import DialogService, rag_agent
from api.db.services.doc_metadata_service import DocMetadataService
from api.db.services.document_counter_service import release_reparse_counters
from api.db.services.document_service import DocumentService
from api.db.services.file2document_service import File2DocumentService
from api.db.services.file_service import FileService
from api.db.services.knowledgebase_service import KnowledgebaseService, validate_dataset_embedding_models
from api.db.services.llm_service import LLMBundle
from api.db.services.task_service import TaskService, cancel_all_task_of
from api.db.services.tenant_llm_service import TenantLLMService
from api.db.services.user_canvas_version import UserCanvasVersionService
from api.utils.reference_metadata_utils import enrich_chunks_with_document_metadata, resolve_reference_metadata_preferences
from common import settings
from common.constants import LLMType, ParserType, StatusEnum, TaskStatus
from common.doc_store.doc_store_base import MatchTextExpr, OrderByExpr
from common.metadata_utils import convert_conditions, filter_doc_ids_by_metadata
from common.misc_utils import get_uuid
from common.time_utils import current_timestamp
from rag.app.tag import label_question
from rag.prompts.generator import cross_languages, keyword_extraction

from .capabilities import MAX_PAGE_LIMIT, Capability
from .cursor import CursorCodec
from .errors import BusinessGatewayError
from .memory_scope import (
    forget_subject_message,
    get_subject_message,
    list_subject_messages,
    recent_subject_messages,
    update_subject_message_status,
)
from .policy import AuthorizationPolicy, _embedded_dataset_ids
from .recovery import RecoveryOutcome, RecoveryPlan, command_target_ids
from .response_contracts import project_response_data
from .retrieval_port import invoke_ragflow_retrieval
from .scope_registry import verify_authorization_seal
from .types import PreparedAuthorization, RagFlowExecutionContext


@dataclass
class AdapterResult:
    data: Any = None
    meta: dict[str, Any] | None = None
    status: int = 200
    passthrough: Response | None = None


_COMMAND_RESULT_OPERATIONS = {
    "datasets.delete",
    "datasets.batchDelete",
    "documents.delete",
    "documents.batchDelete",
    "documents.startParse",
    "documents.cancelParse",
    "chunks.delete",
    "chunks.batchDelete",
    "chats.delete",
    "chats.batchDelete",
    "chatSessions.delete",
    "chatSessions.batchDelete",
    "agentSessions.delete",
    "agentSessions.batchDelete",
    "agents.delete",
    "memories.delete",
    "memoryMessages.create",
    "memoryMessages.batchCreate",
    "memoryMessages.update",
    "memoryMessages.delete",
}


def _normalize_command_result(operation: str, prepared: PreparedAuthorization, result: AdapterResult) -> AdapterResult:
    """Collapse write acknowledgements to the one public command-result shape."""

    if operation not in _COMMAND_RESULT_OPERATIONS or result.passthrough is not None:
        return result
    data = result.data if isinstance(result.data, dict) else {}
    for key in ("successCount", "deleted"):
        value = data.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            result.data = {"successCount": value}
            return result
    payload = prepared.payload or {}
    for key in ("ids", "documentIds", "memoryIds"):
        values = payload.get(key)
        if isinstance(values, list):
            result.data = {"successCount": len(values)}
            return result
    result.data = {"successCount": 1}
    return result


class RagFlowBusinessServiceAdapter:
    """Same-process adapter over RAGFlow application and persistence services."""

    async def invoke(
        self,
        capability: Capability,
        context: RagFlowExecutionContext,
        prepared: PreparedAuthorization,
    ) -> AdapterResult:
        verify_authorization_seal(capability.operation, context, prepared)
        _activate_execution_context(context)
        direct_result = await _invoke_service_command(capability, context, prepared)
        if direct_result is None:
            raise RuntimeError(f"No RAGFlow Business service command is registered for {capability.operation}")
        normalized = _normalize_command_result(capability.operation, prepared, direct_result)
        if normalized.passthrough is None:
            normalized.data = project_response_data(capability.operation, normalized.data)
        return normalized

    async def prepare_recovery(
        self,
        capability: Capability,
        context: RagFlowExecutionContext,
        prepared: PreparedAuthorization,
        command_id: str | None,
    ) -> RecoveryPlan:
        """Build a bounded, credential-free intent before any external mutation."""

        if command_id is None:
            return RecoveryPlan()
        prepared.execution_command_id = command_id
        operation = capability.operation
        if operation in {"chats.create", "chatSessions.create", "agents.create", "agentSessions.create"}:
            return RecoveryPlan(
                "relational-create",
                {
                    "resourceId": command_id,
                    "chatId": prepared.path_args.get("chat_id"),
                    "agentId": prepared.path_args.get("agent_id"),
                },
            )
        if operation == "documents.upload":
            files = await request.files
            documents = []
            for index, upload in enumerate(files.getlist("file")):
                document_id = hashlib.sha256(f"{command_id}:{index}".encode()).hexdigest()[:32]
                upload.id = document_id
                documents.append({"id": document_id, "datasetId": str(prepared.path_args["dataset_id"])})
            return RecoveryPlan("document-upload", {"documents": documents})
        if operation == "chunks.create":
            content = str((prepared.payload or {}).get("content", ""))
            document_id = str(prepared.path_args["document_id"])
            return RecoveryPlan(
                "chunk-create",
                {
                    "chunkId": xxhash.xxh64((content + document_id).encode("utf-8")).hexdigest(),
                    "datasetId": str(prepared.path_args["dataset_id"]),
                    "documentId": document_id,
                },
            )
        if operation in {
            "chats.delete",
            "chats.batchDelete",
            "chatSessions.delete",
            "chatSessions.batchDelete",
            "agents.delete",
            "agentSessions.delete",
            "agentSessions.batchDelete",
        }:
            return RecoveryPlan("relational-delete", {"ids": command_target_ids(operation, prepared)})
        if operation in {"datasets.delete", "datasets.batchDelete"}:
            return RecoveryPlan(
                "dataset-delete",
                {"datasets": [{"id": dataset_id} for dataset_id in command_target_ids(operation, prepared)]},
            )
        if operation in {"documents.delete", "documents.batchDelete"}:
            documents = []
            for document_id in command_target_ids(operation, prepared):
                doc = Document.get_by_id(document_id)
                bucket, key = File2DocumentService.get_storage_address(doc_id=document_id)
                documents.append(
                    {
                        "id": document_id,
                        "datasetId": str(doc.kb_id),
                        "bucket": str(bucket),
                        "key": str(key),
                    }
                )
            return RecoveryPlan("document-delete", {"documents": documents})
        if operation in {"chunks.delete", "chunks.batchDelete"}:
            return RecoveryPlan(
                "chunk-delete",
                {
                    "ids": command_target_ids(operation, prepared),
                    "datasetId": str(prepared.path_args["dataset_id"]),
                    "documentId": str(prepared.path_args["document_id"]),
                },
            )
        if operation in {"documents.startParse", "documents.cancelParse"}:
            documents = []
            for document_id in command_target_ids(operation, prepared):
                doc = Document.get_by_id(document_id)
                documents.append(
                    {
                        "id": document_id,
                        "run": str(doc.run),
                        "taskIds": sorted(str(task.id) for task in TaskService.query(doc_id=document_id)),
                    }
                )
            return RecoveryPlan(
                "parse-state",
                {
                    "datasetId": str(prepared.path_args["dataset_id"]),
                    "documents": documents,
                    "target": "running" if operation == "documents.startParse" else "cancelled",
                },
            )
        return RecoveryPlan()

    async def recover(
        self,
        capability: Capability,
        context: RagFlowExecutionContext,
        prepared: PreparedAuthorization,
        plan: RecoveryPlan,
    ) -> RecoveryOutcome:
        """Converge or prove a prior effect using authoritative RAGFlow stores."""

        verify_authorization_seal(capability.operation, context, prepared)
        _activate_execution_context(context)
        try:
            result = await _recover_effect(capability.operation, context, prepared, plan)
        except Exception:  # noqa: BLE001 - an inconclusive dependency probe must fail closed
            return RecoveryOutcome.unknown()
        if result is None:
            return RecoveryOutcome.unknown()
        result.data = project_response_data(capability.operation, result.data)
        return RecoveryOutcome("applied", result.data, result.meta or {}, result.status)


def _activate_execution_context(context: RagFlowExecutionContext) -> None:
    """Revalidate the local principal before normal execution or recovery."""

    execution_exists, execution_user = UserService.get_by_id(context.execution_user_id)
    service_exists, service_user = UserService.get_by_id(context.tenant_id)
    tenant = Tenant.get_or_none(Tenant.id == context.tenant_id)
    relation = (
        context.execution_user_id == context.tenant_id
        or UserTenant.get_or_none((UserTenant.user_id == context.execution_user_id) & (UserTenant.tenant_id == context.tenant_id) & (UserTenant.status == StatusEnum.VALID.value)) is not None
    )
    if (
        not execution_exists
        or execution_user is None
        or not _active_user(execution_user)
        or not service_exists
        or service_user is None
        or not _active_user(service_user)
        or tenant is None
        or tenant.status != StatusEnum.VALID.value
        or not relation
    ):
        raise BusinessGatewayError(
            "WORKSPACE_NOT_ALLOWED",
            "The workspace execution principal is unavailable.",
            status=403,
            request_id=context.request_id,
        )

    g.user = service_user
    g.auth_type = "BUSINESS_GATEWAY"
    g.auth_via_api_token = False


async def _recover_effect(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
    plan: RecoveryPlan,
) -> AdapterResult | None:
    descriptor = plan.descriptor
    if plan.strategy == "relational-create":
        resource_id = str(descriptor.get("resourceId", ""))
        resource: Any = None
        if operation == "chats.create":
            resource = Dialog.get_or_none((Dialog.id == resource_id) & (Dialog.tenant_id == context.tenant_id))
        elif operation == "chatSessions.create":
            resource = Conversation.get_or_none((Conversation.id == resource_id) & (Conversation.dialog_id == str(descriptor.get("chatId", ""))))
        elif operation == "agents.create":
            resource = UserCanvas.get_or_none((UserCanvas.id == resource_id) & (UserCanvas.user_id == context.tenant_id))
        elif operation == "agentSessions.create":
            resource = API4Conversation.get_or_none((API4Conversation.id == resource_id) & (API4Conversation.dialog_id == str(descriptor.get("agentId", ""))))
        return AdapterResult(data=_public_row(resource.to_dict()), status=201) if resource is not None else None

    if plan.strategy == "document-upload":
        rows = []
        for target in descriptor.get("documents", []):
            document_id = str(target.get("id", ""))
            dataset_id = str(target.get("datasetId", ""))
            doc = Document.get_or_none((Document.id == document_id) & (Document.kb_id == dataset_id))
            if doc is None:
                return None
            bucket, key = File2DocumentService.get_storage_address(doc_id=document_id)
            if not await asyncio.to_thread(settings.STORAGE_IMPL.obj_exist, bucket, key):
                return None
            rows.append(_public_row(doc.to_dict()))
        return AdapterResult(data=rows, status=201) if rows else None

    if plan.strategy == "chunk-create":
        from rag.nlp import search

        dataset_id = str(descriptor.get("datasetId", ""))
        document_id = str(descriptor.get("documentId", ""))
        chunk = settings.docStoreConn.get(
            str(descriptor.get("chunkId", "")),
            search.index_name(context.tenant_id),
            [dataset_id],
        )
        if chunk is None or str(chunk.get("doc_id", chunk.get("document_id", ""))) != document_id:
            return None
        await asyncio.to_thread(_reconcile_document_chunk_count, context, dataset_id, document_id)
        return AdapterResult(data=_public_chunk(chunk, _document_version(document_id)), status=201)

    if plan.strategy == "relational-delete":
        ids = [str(value) for value in descriptor.get("ids", [])]
        if not ids:
            return None
        if operation in {"chats.delete", "chats.batchDelete"}:
            remaining = Dialog.select().where((Dialog.id.in_(ids)) & (Dialog.status == StatusEnum.VALID.value)).exists()
        elif operation in {"chatSessions.delete", "chatSessions.batchDelete"}:
            remaining = Conversation.select().where(Conversation.id.in_(ids)).exists()
        elif operation == "agents.delete":
            remaining = UserCanvas.select().where(UserCanvas.id.in_(ids)).exists()
        elif operation in {"agentSessions.delete", "agentSessions.batchDelete"}:
            remaining = API4Conversation.select().where(API4Conversation.id.in_(ids)).exists()
        else:
            return None
        return None if remaining else AdapterResult(data={"successCount": len(ids)})

    if plan.strategy == "document-delete":
        applied = await asyncio.to_thread(_converge_document_deletions, context, descriptor)
        return AdapterResult(data={"successCount": len(descriptor.get("documents", []))}) if applied else None

    if plan.strategy == "dataset-delete":
        applied = await _converge_dataset_deletions(context, descriptor)
        return AdapterResult(data={"successCount": len(descriptor.get("datasets", []))}) if applied else None

    if plan.strategy == "chunk-delete":
        applied = await asyncio.to_thread(_converge_chunk_deletions, context, descriptor)
        return AdapterResult(data={"successCount": len(descriptor.get("ids", []))}) if applied else None

    if plan.strategy == "parse-state":
        documents = descriptor.get("documents", [])
        if not documents:
            return None
        if descriptor.get("target") == "cancelled":
            applied = all((doc := Document.get_or_none(Document.id == str(target.get("id", "")))) is not None and str(doc.run) == TaskStatus.CANCEL.value for target in documents)
        else:
            applied = True
            for target in documents:
                document_id = str(target.get("id", ""))
                doc = Document.get_or_none(Document.id == document_id)
                before_tasks = {str(value) for value in target.get("taskIds", [])}
                after_tasks = {str(task.id) for task in TaskService.query(doc_id=document_id)}
                if doc is None or not (after_tasks - before_tasks or (str(target.get("run", "")) != TaskStatus.RUNNING.value and str(doc.run) == TaskStatus.RUNNING.value)):
                    applied = False
                    break
        return AdapterResult(data={"successCount": len(documents)}, status=202) if applied else None

    return None


def _converge_document_deletions(context: RagFlowExecutionContext, descriptor: dict[str, Any]) -> bool:
    from rag.nlp import search

    for target in descriptor.get("documents", []):
        document_id = str(target.get("id", ""))
        dataset_id = str(target.get("datasetId", ""))
        if Document.get_or_none((Document.id == document_id) & (Document.kb_id == dataset_id)) is not None:
            FileService.delete_docs([document_id], context.tenant_id)
        bucket, key = str(target.get("bucket", "")), str(target.get("key", ""))
        if bucket and key and settings.STORAGE_IMPL.obj_exist(bucket, key):
            settings.STORAGE_IMPL.rm(bucket, key)
        index_name = search.index_name(context.tenant_id)
        if settings.docStoreConn.index_exist(index_name, dataset_id):
            settings.docStoreConn.delete({"doc_id": document_id}, index_name, dataset_id)
            result = settings.docStoreConn.search([], [], {"doc_id": document_id}, [], OrderByExpr(), 0, 1, index_name, [dataset_id])
            if settings.docStoreConn.get_total(result) != 0:
                return False
        if Document.get_or_none(Document.id == document_id) is not None:
            return False
        if bucket and key and settings.STORAGE_IMPL.obj_exist(bucket, key):
            return False
    return True


async def _converge_dataset_deletions(context: RagFlowExecutionContext, descriptor: dict[str, Any]) -> bool:
    from rag.nlp import search

    for target in descriptor.get("datasets", []):
        dataset_id = str(target.get("id", ""))
        if Knowledgebase.get_or_none((Knowledgebase.id == dataset_id) & (Knowledgebase.tenant_id == context.tenant_id)) is not None:
            await dataset_api_service.delete_datasets(context.tenant_id, [dataset_id], False)
        index_name = search.index_name(context.tenant_id)
        if settings.docStoreConn.index_exist(index_name, dataset_id):
            await asyncio.to_thread(settings.docStoreConn.delete_idx, index_name, dataset_id)
        if Knowledgebase.get_or_none(Knowledgebase.id == dataset_id) is not None:
            return False
        if Document.select().where(Document.kb_id == dataset_id).exists():
            return False
        if settings.docStoreConn.index_exist(index_name, dataset_id):
            return False
    return True


def _converge_chunk_deletions(context: RagFlowExecutionContext, descriptor: dict[str, Any]) -> bool:
    from rag.nlp import search

    ids = [str(value) for value in descriptor.get("ids", [])]
    dataset_id = str(descriptor.get("datasetId", ""))
    document_id = str(descriptor.get("documentId", ""))
    if not ids or not dataset_id or not document_id:
        return False
    index_name = search.index_name(context.tenant_id)
    settings.docStoreConn.delete(
        {"doc_id": document_id, "id": ids, "must_not": {"exists": "compile_kwd"}},
        index_name,
        dataset_id,
    )
    if any(settings.docStoreConn.get(chunk_id, index_name, [dataset_id]) is not None for chunk_id in ids):
        return False
    _reconcile_document_chunk_count(context, dataset_id, document_id)
    return True


def _reconcile_document_chunk_count(
    context: RagFlowExecutionContext,
    dataset_id: str,
    document_id: str,
) -> None:
    from rag.nlp import search

    index_name = search.index_name(context.tenant_id)
    result = settings.docStoreConn.search(
        [],
        [],
        {"doc_id": document_id, "must_not": {"exists": "compile_kwd"}},
        [],
        OrderByExpr(),
        0,
        1,
        index_name,
        [dataset_id],
    )
    Document.update(chunk_num=settings.docStoreConn.get_total(result), update_time=current_timestamp()).where(Document.id == document_id).execute()


async def _invoke_service_command(
    capability: Capability,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult | None:
    """Invoke extracted application services without routing through REST views."""
    operation = capability.operation
    if operation == "authorization.context":
        return AdapterResult(data=context.authorization.to_public_dict(), meta={})
    if operation == "retrieval.search":
        return await _invoke_retrieval_service(context, prepared)
    if operation in {"chatSessions.invoke", "agentSessions.invoke"}:
        return await _invoke_session_service(operation, context, prepared)
    if operation in {
        "documents.list",
        "chats.list",
        "chatSessions.list",
        "agents.list",
        "agentSessions.list",
        "memories.list",
    }:
        return _list_relational_resources(operation, context, prepared)
    relational_result = _invoke_relational_command(operation, context, prepared)
    if relational_result is not None:
        return relational_result
    if operation.startswith(("memories.", "memoryMessages.")):
        return await _invoke_memory_service(operation, context, prepared)
    if operation in {"documents.upload", "documents.download", "documents.update", "documents.delete", "documents.batchDelete"}:
        return await _invoke_document_service(operation, context, prepared)
    if operation in {"chunks.get", "chunks.delete", "chunks.batchDelete"}:
        return _invoke_chunk_service(operation, context, prepared)
    if operation == "chunks.list":
        return await _list_chunks_keyset(context, prepared)
    if operation in {"chunks.create", "chunks.update"}:
        return await _upsert_chunk_service(operation, context, prepared)
    if operation in {"documents.startParse", "documents.cancelParse"}:
        return await _invoke_parse_service(operation, context, prepared)
    if not operation.startswith("datasets."):
        return None
    dataset_id = str(prepared.path_args.get("dataset_id", ""))
    body = _to_snake(dict(prepared.payload or {}))
    if "embedding_model" in body:
        body["embd_id"] = body.pop("embedding_model")
    if "chunk_method" in body:
        body["parser_id"] = body.pop("chunk_method")
    result: Any
    if operation == "datasets.list":
        return _list_datasets_keyset(context, prepared)
    elif operation == "datasets.create":
        body["permission"] = "me"
        result = await dataset_api_service.create_dataset(context.tenant_id, body)
    elif operation == "datasets.get":
        result = dataset_api_service.get_dataset(dataset_id, context.tenant_id)
    elif operation == "datasets.update":
        result = await dataset_api_service.update_dataset(context.tenant_id, dataset_id, body)
    elif operation == "datasets.delete":
        result = await dataset_api_service.delete_datasets(context.tenant_id, [dataset_id], False)
    elif operation == "datasets.batchDelete":
        result = await dataset_api_service.delete_datasets(context.tenant_id, list(body["ids"]), False)
    elif operation == "datasets.getMetadataConfig":
        result = dataset_api_service.get_auto_metadata(dataset_id, context.tenant_id)
    elif operation == "datasets.updateMetadataConfig":
        result = await dataset_api_service.update_auto_metadata(dataset_id, context.tenant_id, body)
    else:
        return None
    if isinstance(result, tuple):
        succeeded, value = result
        if not succeeded:
            raise BusinessGatewayError(
                "INVALID_REQUEST",
                "The RAGFlow service rejected the request.",
                status=400,
                request_id=context.request_id,
                details=value,
            )
    else:
        value = result
    data = _public_row(value) if isinstance(value, dict) else _to_camel(value if value is not None else {})
    return AdapterResult(data=data, meta={})


def _invoke_relational_command(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult | None:
    p = prepared.path_args
    body = _to_snake(dict(prepared.payload or {}))
    resource: Any
    if operation == "documents.get":
        resource = Document.get_or_none(Document.id == str(p["document_id"]))
        return _row_result(resource, context)
    if operation == "chats.create":
        tenant = Tenant.get_by_id(context.tenant_id)
        if Dialog.get_or_none((Dialog.tenant_id == context.tenant_id) & (Dialog.name == body["name"]) & (Dialog.status == StatusEnum.VALID.value)):
            raise BusinessGatewayError("CONFLICT", "A chat with that name already exists.", status=409, request_id=context.request_id)
        if "dataset_ids" in body:
            body["kb_ids"] = body.pop("dataset_ids")
        body.setdefault("kb_ids", [])
        body.setdefault("llm_id", tenant.llm_id)
        body.setdefault("rerank_id", tenant.rerank_id)
        body.setdefault("description", "A helpful Assistant")
        body.setdefault("llm_setting", {})
        body.setdefault("icon", "")
        resource = Dialog.create(id=prepared.execution_command_id or get_uuid(), tenant_id=context.tenant_id, **body)
        return _row_result(resource, context)
    if operation in {"chats.get", "chats.update", "chats.delete"}:
        resource = Dialog.get_or_none(Dialog.id == str(p["chat_id"]))
        if resource is None:
            return _row_result(None, context)
        if operation == "chats.update":
            if "dataset_ids" in body:
                body["kb_ids"] = body.pop("dataset_ids")
            Dialog.update(**body).where(Dialog.id == resource.id).execute()
            resource = Dialog.get_by_id(resource.id)
        elif operation == "chats.delete":
            Dialog.update(status=StatusEnum.INVALID.value).where(Dialog.id == resource.id).execute()
            return AdapterResult(data={})
        return _row_result(resource, context)
    if operation == "chats.batchDelete":
        Dialog.update(status=StatusEnum.INVALID.value).where(Dialog.id.in_(body["ids"])).execute()
        return AdapterResult(data={"successCount": len(body["ids"])})
    if operation in {"chatSessions.create", "chatSessions.get", "chatSessions.update", "chatSessions.delete"}:
        if operation == "chatSessions.create":
            dialog = Dialog.get_by_id(str(p["chat_id"]))
            resource = Conversation.create(
                id=prepared.execution_command_id or get_uuid(),
                dialog_id=str(p["chat_id"]),
                user_id=context.subject,
                name=body.get("name", "New session"),
                message=[{"role": "assistant", "content": (dialog.prompt_config or {}).get("prologue", "")}],
                reference=[],
            )
        else:
            resource = Conversation.get_or_none(Conversation.id == str(p["session_id"]))
            if resource is None:
                return _row_result(None, context)
            if operation == "chatSessions.update":
                Conversation.update(**body).where(Conversation.id == resource.id).execute()
                resource = Conversation.get_by_id(resource.id)
            elif operation == "chatSessions.delete":
                Conversation.delete().where(Conversation.id == resource.id).execute()
                return AdapterResult(data={})
        return _row_result(resource, context)
    if operation == "chatSessions.batchDelete":
        count = Conversation.delete().where(Conversation.id.in_(body["ids"])).execute()
        return AdapterResult(data={"successCount": count})
    if operation in {"agents.create", "agents.get", "agents.update", "agents.delete"}:
        if operation == "agents.create":
            resource = UserCanvas.create(
                id=prepared.execution_command_id or get_uuid(),
                user_id=context.tenant_id,
                title=body["title"],
                dsl=body["dsl"],
                description=body.get("description", ""),
                canvas_type=body.get("canvas_type"),
                canvas_category="agent_canvas",
            )
        else:
            resource = UserCanvas.get_or_none(UserCanvas.id == str(p["agent_id"]))
            if resource is None:
                return _row_result(None, context)
            if operation == "agents.update":
                body.pop("canvas_category", None)
                UserCanvas.update(**body).where(UserCanvas.id == resource.id).execute()
                resource = UserCanvas.get_by_id(resource.id)
            elif operation == "agents.delete":
                UserCanvas.delete().where(UserCanvas.id == resource.id).execute()
                return AdapterResult(data={})
        return _row_result(resource, context)
    if operation in {"agentSessions.get", "agentSessions.delete"}:
        resource = API4Conversation.get_or_none(API4Conversation.id == str(p["session_id"]))
        if resource is None:
            return _row_result(None, context)
        if operation == "agentSessions.delete":
            API4Conversation.delete().where(API4Conversation.id == resource.id).execute()
            return AdapterResult(data={})
        return _row_result(resource, context)
    if operation == "agentSessions.create":
        from agent.canvas import Canvas

        agent, dsl = UserCanvasService.get_agent_dsl_with_release(
            str(p["agent_id"]),
            bool(body.get("release", False)),
            context.tenant_id,
        )
        canvas = Canvas(dsl, context.tenant_id, agent.id, canvas_id=agent.id)
        canvas.reset()
        resource = API4Conversation.create(
            id=prepared.execution_command_id or get_uuid(),
            name=body.get("name", ""),
            dialog_id=agent.id,
            user_id=context.subject,
            exp_user_id=context.subject,
            message=[{"role": "assistant", "content": canvas.get_prologue()}],
            source="agent",
            dsl=json.loads(str(canvas)),
            reference=[],
            version_title=UserCanvasVersionService.get_latest_version_title(agent.id, release_mode=bool(body.get("release", False))),
        )
        return _row_result(resource, context)
    if operation == "agentSessions.batchDelete":
        count = API4Conversation.delete().where(API4Conversation.id.in_(body["ids"])).execute()
        return AdapterResult(data={"successCount": count})
    return None


async def _invoke_memory_service(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult:
    p = prepared.path_args
    body = _to_snake(dict(prepared.payload or {}))
    query = _to_snake(dict(prepared.query))
    memory_id = str(p.get("memory_id", ""))
    message_id = int(p["message_id"]) if p.get("message_id") is not None else 0
    if operation == "memories.create":
        result = await memory_api_service.create_memory(body)
    elif operation == "memories.get" or operation == "memories.getConfig":
        result = await memory_api_service.get_memory_config(memory_id)
    elif operation == "memories.update":
        result = await memory_api_service.update_memory(memory_id, body)
    elif operation == "memories.delete":
        result = await memory_api_service.delete_memory(memory_id)
    elif operation == "memoryMessages.list":
        limit = _page_limit(query.get("limit", MAX_PAGE_LIMIT))
        codec: CursorCodec = current_app.extensions["business_gateway_cursor_codec"]
        cursor_filters = _cursor_filters(prepared, query)
        decoded = (
            codec.decode(
                str(query["cursor"]),
                operation,
                context,
                cursor_filters,
                _cursor_scope_hash(prepared),
            )
            if query.get("cursor")
            else None
        )
        page = list_subject_messages(
            memory_id,
            context.tenant_id,
            context.subject,
            limit,
            context.request_id,
            snapshot=decoded.snapshot if decoded is not None else None,
            after=decoded.after if decoded is not None else None,
        )
        next_cursor = (
            codec.encode(
                operation,
                context,
                cursor_filters,
                page.snapshot,
                page.after,
                _cursor_scope_hash(prepared),
            )
            if page.has_next
            else None
        )
        return AdapterResult(
            data=[_public_memory_message(message) for message in page.data["messages"]["message_list"]],
            meta={
                "limit": limit,
                "hasNext": page.has_next,
                "nextCursor": next_cursor,
            },
        )
    elif operation in {"memoryMessages.create", "memoryMessages.batchCreate"}:
        memory_ids = body.pop("memory_ids", None) or [memory_id]
        body["user_id"] = context.subject
        result = await memory_api_service.add_message(memory_ids, body)
    elif operation == "memoryMessages.search":
        result = await memory_api_service.search_message(
            {
                "memory_id": query.pop("memory_ids"),
                "agent_id": query.pop("agent_id", ""),
                "session_id": query.pop("session_id", ""),
                "user_id": context.subject,
            },
            query,
        )
    elif operation == "memoryMessages.recent":
        result = recent_subject_messages(
            query["memory_ids"],
            context.tenant_id,
            context.subject,
            query.get("agent_id", ""),
            query.get("session_id", ""),
            int(query.get("limit", 10)),
            context.request_id,
        )
    elif operation == "memoryMessages.getContent":
        result = get_subject_message(memory_id, message_id, context.tenant_id, context.subject, context.request_id)
    elif operation == "memoryMessages.update":
        result = update_subject_message_status(
            memory_id,
            message_id,
            context.tenant_id,
            context.subject,
            bool(body["status"]),
            context.request_id,
        )
        Memory.update(update_time=current_timestamp()).where(Memory.id == memory_id).execute()
    elif operation == "memoryMessages.delete":
        result = forget_subject_message(memory_id, message_id, context.tenant_id, context.subject, context.request_id)
        Memory.update(update_time=current_timestamp()).where(Memory.id == memory_id).execute()
    else:
        raise RuntimeError(f"No memory service command for {operation}")
    if isinstance(result, tuple):
        succeeded, value = result
        if not succeeded:
            raise BusinessGatewayError("INVALID_REQUEST", "The RAGFlow service rejected the request.", status=400, request_id=context.request_id)
    else:
        value = result
    if operation in {"memoryMessages.search", "memoryMessages.recent"} and isinstance(value, list):
        data = [_public_memory_message(message) for message in value]
    elif operation == "memoryMessages.getContent" and isinstance(value, dict):
        data = _public_memory_message(value)
    elif isinstance(value, dict):
        data = _public_row(value)
    else:
        data = _to_camel(value if value is not None and value is not True else {})
    return AdapterResult(data=data)


async def _invoke_retrieval_service(
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult:
    body = _to_snake(dict(prepared.payload or {}))
    dataset_ids = list(body["dataset_ids"])
    document_ids = list(body.get("document_ids") or [])
    question = str(body["question"]).strip()
    limit = _page_limit(body.get("limit", MAX_PAGE_LIMIT))
    top = int(body.get("top_k", 1024))
    if top < 1 or top > 10_000:
        raise BusinessGatewayError("INVALID_REQUEST", "topK must be from 1 to 10000.", status=400, request_id=context.request_id)
    if not question:
        return AdapterResult(data={"total": 0, "chunks": [], "docAggs": {}}, meta={"limit": limit, "hasNext": False, "nextCursor": None})

    knowledgebases = KnowledgebaseService.get_by_ids(dataset_ids)
    embedding_error = validate_dataset_embedding_models(knowledgebases)
    if embedding_error:
        raise BusinessGatewayError("INVALID_REQUEST", "The selected datasets do not share a compatible embedding model.", status=400, request_id=context.request_id)
    if not document_ids and body.get("metadata_condition"):
        condition = body["metadata_condition"]
        document_ids = filter_doc_ids_by_metadata(
            dataset_ids,
            convert_conditions(condition),
            condition.get("logic", "and"),
            lambda: DocMetadataService.get_flatted_meta_by_kbs(dataset_ids),
        )
        if not document_ids and condition.get("conditions"):
            return AdapterResult(data={"total": 0, "chunks": [], "docAggs": {}}, meta={"limit": limit, "hasNext": False, "nextCursor": None})

    kb = knowledgebases[0]
    tenant_ids = sorted({item.tenant_id for item in knowledgebases})
    embedding_config = resolve_model_config(kb.tenant_id, LLMType.EMBEDDING, kb.embd_id)
    embedding_model = LLMBundle(kb.tenant_id, embedding_config)
    rerank_model = None
    if body.get("rerank_id"):
        rerank_model = LLMBundle(kb.tenant_id, resolve_model_config(kb.tenant_id, LLMType.RERANK, body["rerank_id"]))
    if body.get("cross_languages"):
        question = await cross_languages(kb.tenant_id, None, question, body["cross_languages"])
    if body.get("keyword", False):
        chat_config = get_tenant_default_model_by_type(kb.tenant_id, LLMType.CHAT)
        question += await keyword_extraction(LLMBundle(kb.tenant_id, chat_config), question)

    ranks = await invoke_ragflow_retrieval(
        settings.retriever,
        question=question,
        embedding_model=embedding_model,
        tenant_ids=tenant_ids,
        dataset_ids=dataset_ids,
        top_k=top,
        similarity_threshold=float(body.get("similarity_threshold", 0.2)),
        vector_similarity_weight=float(body.get("vector_similarity_weight", 0.3)),
        document_ids=document_ids,
        rerank_model=rerank_model,
        highlight=bool(body.get("highlight", False)),
        rank_feature=label_question(question, knowledgebases),
        trace_id=context.request_id,
    )
    chunks = list(ranks.get("chunks") or [])
    if body.get("toc_enhance"):
        chat_config = get_tenant_default_model_by_type(kb.tenant_id, LLMType.CHAT)
        enhanced = await settings.retriever.retrieval_by_toc(question, chunks, tenant_ids, LLMBundle(kb.tenant_id, chat_config), top)
        if enhanced:
            chunks = enhanced
    chunks = settings.retriever.retrieval_by_children(chunks, tenant_ids)
    if body.get("use_kg"):
        chat_config = get_tenant_default_model_by_type(kb.tenant_id, LLMType.CHAT)
        graph_chunk = await settings.kg_retriever.retrieval(question, tenant_ids, dataset_ids, embedding_model, LLMBundle(kb.tenant_id, chat_config))
        if graph_chunk.get("content_with_weight"):
            chunks.insert(0, graph_chunk)
    include_metadata, metadata_fields = resolve_reference_metadata_preferences(body)
    if include_metadata:
        enrich_chunks_with_document_metadata(chunks, metadata_fields)
    for chunk in chunks:
        chunk.pop("vector", None)

    codec: CursorCodec = current_app.extensions["business_gateway_cursor_codec"]
    cursor_filters = _cursor_filters(prepared, body)
    decoded = codec.decode(str(body["cursor"]), "retrieval.search", context, cursor_filters, _cursor_scope_hash(prepared)) if body.get("cursor") else None
    keyed = [(_retrieval_key(chunk), chunk) for chunk in chunks]
    keyed.sort(key=lambda item: item[0], reverse=True)
    if decoded is not None:
        keyed = [(key, chunk) for key, chunk in keyed if key <= decoded.snapshot and key < decoded.after]
    page = keyed[:limit]
    has_next = len(keyed) > limit
    snapshot = decoded.snapshot if decoded is not None else (keyed[0][0] if keyed else (0, ""))
    next_cursor = codec.encode("retrieval.search", context, cursor_filters, snapshot, page[-1][0], _cursor_scope_hash(prepared)) if has_next and page else None
    key_mapping = {
        "chunk_id": "id",
        "content_with_weight": "content",
        "doc_id": "document_id",
        "important_kwd": "important_keywords",
        "question_kwd": "questions",
        "docnm_kwd": "document_keyword",
        "kb_id": "dataset_id",
    }
    public_chunks = [{key_mapping.get(key, key): value for key, value in chunk.items()} for _, chunk in page]
    data = {
        "chunks": _to_camel(public_chunks),
        "total": int(ranks.get("total") or len(chunks)),
        "docAggs": _to_camel(ranks.get("doc_aggs") or {}),
    }
    return AdapterResult(data=data, meta={"limit": limit, "hasNext": has_next, "nextCursor": next_cursor})


def _retrieval_key(chunk: dict[str, Any]) -> tuple[int, str]:
    score = chunk.get("similarity", chunk.get("score", chunk.get("similarity_score", 0)))
    try:
        normalized_score = int(float(score) * 1_000_000_000)
    except (TypeError, ValueError):
        normalized_score = 0
    chunk_id = str(chunk.get("chunk_id", chunk.get("id", "")))
    return normalized_score, chunk_id


async def _invoke_session_service(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult:
    body = dict(prepared.payload or {})
    kwargs: dict[str, Any] = {}
    if "inputs" in body:
        kwargs["inputs"] = body["inputs"]
    if "release" in body:
        kwargs["release"] = body["release"]
    question = body.get("question")
    if not isinstance(question, str) or not question.strip():
        raise BusinessGatewayError("INVALID_REQUEST", "question must not be empty.", status=400, request_id=context.request_id)
    question = question.strip()
    if operation == "chatSessions.invoke":
        chat_id = str(prepared.path_args["chat_id"])
        session_id = str(prepared.path_args["session_id"])
        dialog = DialogService.get_by_id(chat_id)[1]
        conversation = ConversationService.get_by_id(session_id)[1]
        message_id = get_uuid()
        conversation.message = list(conversation.message or [])
        conversation.message.append({"role": "user", "content": question, "id": message_id})
        messages = []
        for message in conversation.message:
            if message.get("role") == "system":
                continue
            if message.get("role") == "assistant" and not messages:
                continue
            messages.append(message)
        conversation.reference = list(conversation.reference or [])
        conversation.reference.append({"chunks": [], "doc_aggs": []})
        answer = None
        async for result in rag_agent(dialog, messages, False, session_id=session_id, **kwargs):
            answer = structure_answer(conversation, result, message_id, session_id)
            answer["chat_id"] = chat_id
            break
        if answer is None:
            answer = {"answer": "", "content": "", "session_id": session_id, "chat_id": chat_id}
        await asyncio.to_thread(ConversationService.update_by_id, session_id, conversation.to_dict())
        public_answer = _to_camel(_sanitize_numbers(answer))
        content = public_answer.get("content") or public_answer.get("answer") or ""
        data: dict[str, Any] = {
            "content": str(content),
            "role": "assistant",
            "sessionId": session_id,
        }
        if public_answer.get("reference") is not None:
            data["reference"] = public_answer["reference"]
        if body.get("returnTrace") and public_answer.get("trace") is not None:
            data["trace"] = public_answer["trace"]
        return AdapterResult(data=data)

    agent_id = str(prepared.path_args["agent_id"])
    session_id = str(prepared.path_args["session_id"])
    content = ""
    reference: Any = None
    event_data: dict[str, Any] = {}
    async for raw_event in agent_completion(
        tenant_id=context.tenant_id,
        agent_id=agent_id,
        session_id=session_id,
        query=question,
        user_id=context.subject,
        **kwargs,
    ):
        if not isinstance(raw_event, str) or not raw_event.startswith("data:"):
            continue
        try:
            event = json.loads(raw_event[5:])
        except json.JSONDecodeError:
            continue
        event_data = event.get("data") if isinstance(event.get("data"), dict) else {}
        if event.get("event") == "message":
            content += str(event_data.get("content", ""))
        if event_data.get("reference") is not None:
            reference = copy.deepcopy(event_data["reference"])
    data: dict[str, Any] = {"content": content, "role": "assistant", "sessionId": session_id}
    if reference is not None:
        data["reference"] = reference
    if body.get("returnTrace") and event_data.get("trace") is not None:
        data["trace"] = event_data["trace"]
    return AdapterResult(data=_sanitize_numbers(data))


def _sanitize_numbers(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _sanitize_numbers(member) for key, member in value.items()}
    if isinstance(value, list):
        return [_sanitize_numbers(member) for member in value]
    return value


async def _invoke_document_service(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult:
    dataset_id = str(prepared.path_args["dataset_id"])
    if operation == "documents.upload":
        kb = Knowledgebase.get_or_none(Knowledgebase.id == dataset_id)
        files = await request.files
        uploads = files.getlist("file")
        errors, created = await asyncio.to_thread(FileService.upload_document, kb, uploads, context.tenant_id)
        if errors:
            raise BusinessGatewayError(
                "RAGFLOW_SERVICE_ERROR",
                "One or more documents could not be uploaded.",
                status=502,
                request_id=context.request_id,
                retryable=True,
            )
        return AdapterResult(data=[_public_row(item[0]) for item in created])
    if operation == "documents.update":
        document_id = str(prepared.path_args["document_id"])
        doc = Document.get_by_id(document_id)
        kb = Knowledgebase.get_by_id(dataset_id)
        values = _to_snake(dict(prepared.payload or {}))
        if "name" in values and values["name"] != doc.name:
            duplicate = Document.get_or_none((Document.kb_id == dataset_id) & (Document.name == values["name"]) & (Document.id != document_id))
            if duplicate is not None:
                raise BusinessGatewayError("CONFLICT", "A document with that name already exists.", status=409, request_id=context.request_id)
            if update_document_name_only(document_id, values["name"]) is not None:
                raise BusinessGatewayError("RAGFLOW_SERVICE_ERROR", "The document name could not be updated.", status=502, request_id=context.request_id)
        if "parser_config" in values:
            DocumentService.update_parser_config(document_id, values["parser_config"])
        if "meta_fields" in values and not DocMetadataService.update_document_metadata(document_id, values["meta_fields"]):
            raise BusinessGatewayError("RAGFLOW_SERVICE_ERROR", "The document metadata could not be updated.", status=502, request_id=context.request_id)
        if "pipeline_id" in values and reset_document_for_reparse(doc, context.tenant_id, pipeline_id=values["pipeline_id"] or "") is not None:
            raise BusinessGatewayError("RAGFLOW_SERVICE_ERROR", "The document parser could not be reset.", status=502, request_id=context.request_id)
        if "chunk_method" in values and update_chunk_method(values, doc, context.tenant_id) is not None:
            raise BusinessGatewayError("RAGFLOW_SERVICE_ERROR", "The document chunk method could not be updated.", status=502, request_id=context.request_id)
        if "enabled" in values and update_document_status_only(int(values["enabled"]), doc, kb) is not None:
            raise BusinessGatewayError("RAGFLOW_SERVICE_ERROR", "The document status could not be updated.", status=502, request_id=context.request_id)
        updated = Document.get_by_id(document_id)
        return _row_result(updated, context)
    document_ids = [str(prepared.path_args["document_id"])] if operation in {"documents.download", "documents.delete"} else list((prepared.payload or {})["ids"])
    if operation in {"documents.delete", "documents.batchDelete"}:
        errors = await asyncio.to_thread(FileService.delete_docs, document_ids, context.tenant_id)
        if errors:
            raise BusinessGatewayError(
                "RAGFLOW_SERVICE_ERROR",
                "One or more documents could not be deleted.",
                status=502,
                request_id=context.request_id,
                retryable=True,
            )
        return AdapterResult(data={"deleted": len(document_ids)})
    document_id = document_ids[0]
    doc = Document.get_or_none((Document.id == document_id) & (Document.kb_id == dataset_id))
    if doc is None:
        raise BusinessGatewayError("RESOURCE_NOT_FOUND", "The requested resource was not found.", status=404, request_id=context.request_id)
    storage_bucket, storage_key = File2DocumentService.get_storage_address(doc_id=document_id)
    content = await asyncio.to_thread(settings.STORAGE_IMPL.get, storage_bucket, storage_key)
    if content is None:
        raise BusinessGatewayError("RESOURCE_NOT_FOUND", "The requested resource was not found.", status=404, request_id=context.request_id)
    response = await send_file(BytesIO(content), as_attachment=True, attachment_filename=doc.name, mimetype="application/octet-stream")
    return AdapterResult(status=200, passthrough=response)


def _invoke_chunk_service(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult:
    from rag.nlp import search

    dataset_id = str(prepared.path_args["dataset_id"])
    document_id = str(prepared.path_args["document_id"])
    index_name = search.index_name(context.tenant_id)
    if operation == "chunks.get":
        chunk_id = str(prepared.path_args["chunk_id"])
        chunk = settings.docStoreConn.get(chunk_id, index_name, [dataset_id])
        if chunk is None or str(chunk.get("doc_id", chunk.get("document_id"))) != document_id or chunk.get("compile_kwd"):
            raise BusinessGatewayError("RESOURCE_NOT_FOUND", "The requested resource was not found.", status=404, request_id=context.request_id)
        return AdapterResult(data=_public_chunk(chunk, _document_version(document_id)))
    chunk_ids = [str(prepared.path_args["chunk_id"])] if operation == "chunks.delete" else list((prepared.payload or {})["ids"])
    deleted = settings.docStoreConn.delete(
        {"doc_id": document_id, "id": chunk_ids, "must_not": {"exists": "compile_kwd"}},
        index_name,
        dataset_id,
    )
    if deleted:
        DocumentService.decrement_chunk_num(document_id, dataset_id, 1, deleted, 0)
    if deleted != len(chunk_ids):
        raise BusinessGatewayError("RESOURCE_NOT_FOUND", "One or more requested resources were not found.", status=404, request_id=context.request_id)
    return AdapterResult(data={"deleted": deleted})


async def _list_chunks_keyset(
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult:
    from rag.nlp import search

    dataset_id = str(prepared.path_args["dataset_id"])
    document_id = str(prepared.path_args["document_id"])
    query = prepared.query
    limit = _page_limit(query.get("limit", MAX_PAGE_LIMIT))
    codec: CursorCodec = current_app.extensions["business_gateway_cursor_codec"]
    cursor_filters = _cursor_filters(prepared, query)
    decoded = codec.decode(str(query["cursor"]), "chunks.list", context, cursor_filters, _cursor_scope_hash(prepared)) if query.get("cursor") else None
    condition: dict[str, Any] = {"doc_id": [document_id], "must_not": {"exists": "compile_kwd"}}
    if query.get("id"):
        condition["id"] = [str(query["id"])]
    if decoded is not None:
        condition["create_timestamp_flt"] = {"lte": decoded.after[0] / 1_000_000}
    matches = []
    if query.get("keywords"):
        matches.append(MatchTextExpr(["content_ltks", "content_sm_ltks", "important_kwd", "question_kwd"], str(query["keywords"]), limit * 20))
    fields = [
        "id",
        "content_with_weight",
        "doc_id",
        "docnm_kwd",
        "important_kwd",
        "question_kwd",
        "kb_id",
        "img_id",
        "doc_type_kwd",
        "available_int",
        "position_int",
        "tag_kwd",
        "tag_feas",
        "create_timestamp_flt",
    ]
    order_by = OrderByExpr().desc("create_timestamp_flt").desc("id")
    index_name = search.index_name(context.tenant_id)
    result, _ = await asyncio.to_thread(
        settings.docStoreConn.search,
        fields,
        [],
        condition,
        matches,
        order_by,
        0,
        limit * 20 + 1,
        index_name,
        [dataset_id],
        [],
    )
    records = list((settings.docStoreConn.get_fields(result, fields) or {}).values())
    keyed = [(_chunk_key(record), record) for record in records]
    keyed.sort(key=lambda item: item[0], reverse=True)
    if decoded is not None:
        keyed = [(key, record) for key, record in keyed if key <= decoded.snapshot and key < decoded.after]
    page = keyed[:limit]
    has_next = len(keyed) > limit
    snapshot = decoded.snapshot if decoded is not None else (keyed[0][0] if keyed else (0, ""))
    next_cursor = codec.encode("chunks.list", context, cursor_filters, snapshot, page[-1][0], _cursor_scope_hash(prepared)) if has_next and page else None
    document_version = _document_version(document_id)
    chunks = [_public_chunk(record, document_version) for _, record in page]
    return AdapterResult(data=chunks, meta={"limit": limit, "hasNext": has_next, "nextCursor": next_cursor})


def _public_chunk(record: dict[str, Any], version: int) -> dict[str, Any]:
    return {
        "id": str(record.get("id", "")),
        "content": str(record.get("content_with_weight", record.get("content", ""))),
        "documentId": str(record.get("doc_id", record.get("document_id", ""))),
        "documentName": record.get("docnm_kwd", record.get("document_name")),
        "importantKeywords": list(record.get("important_kwd", record.get("important_keywords", [])) or []),
        "questions": list(record.get("question_kwd", record.get("questions", [])) or []),
        "datasetId": str(record.get("kb_id", record.get("dataset_id", ""))),
        "imageId": record.get("img_id", record.get("image_id", "")),
        "documentType": record.get("doc_type_kwd", record.get("document_type", "text")),
        "available": bool(int(record.get("available_int", record.get("available", 1)))),
        "positions": list(record.get("position_int", record.get("positions", [])) or []),
        "tags": list(record.get("tag_kwd", record.get("tags", [])) or []),
        "tagFeatures": dict(record.get("tag_feas", record.get("tag_features", {})) or {}),
        "version": version,
    }


def _chunk_key(chunk: dict[str, Any]) -> tuple[int, str]:
    try:
        timestamp = int(float(chunk.get("create_timestamp_flt", 0)) * 1_000_000)
    except (TypeError, ValueError):
        timestamp = 0
    return timestamp, str(chunk.get("id", ""))


async def _upsert_chunk_service(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult:
    from rag.app.qa import beAdoc, rmPrefix
    from rag.nlp import rag_tokenizer, search

    dataset_id = str(prepared.path_args["dataset_id"])
    document_id = str(prepared.path_args["document_id"])
    doc = Document.get_by_id(document_id)
    body = _to_snake(dict(prepared.payload or {}))
    index_name = search.index_name(context.tenant_id)
    if operation == "chunks.create":
        content = body["content"]
        chunk_id = xxhash.xxh64((content + document_id).encode("utf-8")).hexdigest()
        existing: dict[str, Any] = {}
    else:
        chunk_id = str(prepared.path_args["chunk_id"])
        existing = settings.docStoreConn.get(chunk_id, index_name, [dataset_id]) or {}
        if str(existing.get("doc_id", existing.get("document_id", ""))) != document_id or existing.get("compile_kwd"):
            raise BusinessGatewayError("RESOURCE_NOT_FOUND", "The requested resource was not found.", status=404, request_id=context.request_id)
        content = body.get("content", existing.get("content_with_weight", ""))
    if not isinstance(content, str) or not content.strip():
        raise BusinessGatewayError("INVALID_REQUEST", "content must not be empty.", status=400, request_id=context.request_id)

    record: dict[str, Any] = {
        "id": chunk_id,
        "content_with_weight": content,
        "content_ltks": rag_tokenizer.tokenize(content),
        "doc_id": document_id,
        "kb_id": dataset_id,
        "docnm_kwd": doc.name,
    }
    record["content_sm_ltks"] = rag_tokenizer.fine_grained_tokenize(record["content_ltks"])
    if operation == "chunks.create":
        now = datetime.now(UTC)
        record.update({"doc_type_kwd": "text", "create_time": str(now).replace("T", " ")[:19], "create_timestamp_flt": now.timestamp()})
    for source, target in (("important_keywords", "important_kwd"), ("questions", "question_kwd"), ("positions", "position_int")):
        if source in body:
            record[target] = body[source]
    if "important_keywords" in body:
        record["important_tks"] = rag_tokenizer.tokenize(" ".join(body["important_keywords"]))
    if "questions" in body:
        record["question_kwd"] = [str(value).strip() for value in body["questions"] if str(value).strip()]
        record["question_tks"] = rag_tokenizer.tokenize("\n".join(record["question_kwd"]))
    if "available" in body:
        record["available_int"] = int(body["available"])

    embedding_id = DocumentService.get_embd_id(document_id)
    model_config = resolve_model_config(context.tenant_id, LLMType.EMBEDDING.value, embedding_id)
    embedding_model = TenantLLMService.model_instance(model_config)
    if doc.parser_id == ParserType.QA:
        parts = [part for part in re.split(r"[\n\t]", content) if len(part) > 1]
        if len(parts) != 2:
            raise BusinessGatewayError("INVALID_REQUEST", "Q&A chunks must contain one question and one answer separated by TAB or newline.", status=400, request_id=context.request_id)
        question, answer = rmPrefix(parts[0]), rmPrefix(parts[1])
        record = beAdoc(record, parts[0], parts[1], not any(rag_tokenizer.is_chinese(value) for value in question + answer))
    vectors, token_count = await asyncio.to_thread(
        embedding_model.encode,
        [doc.name, content if not record.get("question_kwd") else "\n".join(record["question_kwd"])],
    )
    vector = 0.1 * vectors[0] + 0.9 * vectors[1] if doc.parser_id != ParserType.QA else vectors[1]
    record[f"q_{len(vector)}_vec"] = vector.tolist()
    if operation == "chunks.create":
        settings.docStoreConn.insert([record], index_name, dataset_id)
        DocumentService.increment_chunk_num(document_id, dataset_id, token_count, 1, 0)
        return AdapterResult(data={"id": chunk_id, "content": content, "documentId": document_id, "datasetId": dataset_id, "version": _document_version(document_id)})
    settings.docStoreConn.update({"id": chunk_id}, record, index_name, dataset_id)
    Document.update(update_time=current_timestamp()).where(Document.id == document_id).execute()
    return AdapterResult(data={"id": chunk_id, "content": content, "documentId": document_id, "datasetId": dataset_id, "version": _document_version(document_id)})


async def _invoke_parse_service(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult:
    from rag.nlp import search

    dataset_id = str(prepared.path_args["dataset_id"])
    document_ids = list((prepared.payload or {})["documentIds"])

    def execute() -> dict[str, Any]:
        success_count = 0
        kb_table_num_map: dict[str, Any] = {}
        documents = [Document.get_by_id(document_id) for document_id in document_ids]
        if operation == "documents.cancelParse":
            for doc in documents:
                tasks = list(TaskService.query(doc_id=doc.id))
                if str(doc.run) not in {TaskStatus.RUNNING.value, TaskStatus.CANCEL.value} and not any((task.progress or 0) < 1 for task in tasks):
                    raise BusinessGatewayError(
                        "CONFLICT",
                        "A document that is not running cannot be cancelled.",
                        status=409,
                        request_id=context.request_id,
                    )
        for doc in documents:
            document_id = doc.id
            if operation == "documents.startParse":
                info = {"run": str(TaskStatus.RUNNING.value), "progress": 0}
                if str(doc.run) == TaskStatus.DONE.value:
                    DocumentService.clear_chunk_num_when_rerun(doc.id)
                    info.update({"progress_msg": "", "chunk_num": 0, "token_num": 0})
                DocumentService.update_by_id(document_id, info)
                TaskService.filter_delete([Task.doc_id == document_id])
                from rag.advanced_rag.knowlege_compile.dataset_nav import remove_dataset_nav_doc_sync

                remove_dataset_nav_doc_sync(context.tenant_id, dataset_id, document_id)
                index_name = search.index_name(context.tenant_id)
                if settings.docStoreConn.index_exist(index_name, dataset_id):
                    settings.docStoreConn.delete({"doc_id": document_id}, index_name, dataset_id)
                DocumentService.run(context.tenant_id, doc.to_dict(), kb_table_num_map)
            else:
                cancel_all_task_of(document_id)
                release_reparse_counters(document_id)
                DocumentService.update_by_id(document_id, {"run": str(TaskStatus.CANCEL.value), "progress": 0})
                index_name = search.index_name(context.tenant_id)
                if settings.docStoreConn.index_exist(index_name, dataset_id):
                    settings.docStoreConn.delete({"doc_id": document_id}, index_name, dataset_id)
            success_count += 1
        return {"successCount": success_count}

    return AdapterResult(data=await asyncio.to_thread(execute))


def _row_result(resource: Any, context: RagFlowExecutionContext) -> AdapterResult:
    if resource is None:
        raise BusinessGatewayError("RESOURCE_NOT_FOUND", "The requested resource was not found.", status=404, request_id=context.request_id)
    return AdapterResult(data=_public_row(resource.to_dict()))


def _public_row(row: dict[str, Any]) -> dict[str, Any]:
    value = dict(row)
    if value.get("id") is not None:
        raw_version = value.get("update_time") or value.get("create_time")
        try:
            value["version"] = max(int(raw_version), 1) if raw_version is not None else 1
        except (TypeError, ValueError):
            value["version"] = 1
    for source, target in (
        ("kb_id", "dataset_id"),
        ("kb_ids", "dataset_ids"),
        ("parser_id", "chunk_method"),
        ("embd_id", "embedding_model"),
        ("doc_num", "document_count"),
        ("chunk_num", "chunk_count"),
        ("token_num", "token_count"),
        ("dialog_id", "owner_id"),
    ):
        if source in value:
            value[target] = value.pop(source)
    for name in ("tenant_id", "tenant_embd_id", "tenant_llm_id", "tenant_rerank_id", "user_id", "created_by"):
        value.pop(name, None)
    return _to_camel(value)


def _public_memory_message(row: dict[str, Any]) -> dict[str, Any]:
    value = _public_row(row)
    for name in ("messageId", "sourceId"):
        raw = value.get(name)
        if raw is not None:
            try:
                value[name] = int(raw)
            except (TypeError, ValueError):
                pass
    status = value.get("status")
    if status == 0 or status == 1:
        value["status"] = bool(status)
    return value


def _document_version(document_id: str) -> int:
    document = Document.get_by_id(document_id)
    raw = document.update_time or document.create_time or 1
    try:
        return max(int(raw), 1)
    except (TypeError, ValueError):
        return 1


def _list_datasets_keyset(context: RagFlowExecutionContext, prepared: PreparedAuthorization) -> AdapterResult:
    query = prepared.query
    limit = _page_limit(query.get("limit", MAX_PAGE_LIMIT))
    statement = Knowledgebase.select().where((Knowledgebase.tenant_id == context.tenant_id) & (Knowledgebase.status == StatusEnum.VALID.value) & (Knowledgebase.id.in_(prepared.dataset_ids)))
    if query.get("id"):
        statement = statement.where(Knowledgebase.id == str(query["id"]))
    if query.get("ids"):
        ids = query["ids"] if isinstance(query["ids"], list) else [query["ids"]]
        statement = statement.where(Knowledgebase.id.in_(ids))
    if query.get("name"):
        statement = statement.where(Knowledgebase.name == str(query["name"]))

    codec: CursorCodec = current_app.extensions["business_gateway_cursor_codec"]
    cursor_filters = _cursor_filters(prepared, query)
    decoded = codec.decode(str(query["cursor"]), "datasets.list", context, cursor_filters, _cursor_scope_hash(prepared)) if query.get("cursor") else None
    if decoded is not None:
        snapshot_time, snapshot_id = decoded.snapshot
        after_time, after_id = decoded.after
        statement = statement.where(
            ((Knowledgebase.create_time < snapshot_time) | ((Knowledgebase.create_time == snapshot_time) & (Knowledgebase.id <= snapshot_id)))
            & ((Knowledgebase.create_time < after_time) | ((Knowledgebase.create_time == after_time) & (Knowledgebase.id < after_id)))
        )
    rows = list(statement.order_by(Knowledgebase.create_time.desc(), Knowledgebase.id.desc()).limit(limit + 1).dicts())
    page = rows[:limit]
    has_next = len(rows) > limit
    if decoded is not None:
        snapshot = decoded.snapshot
    elif page:
        snapshot = (int(page[0].get("create_time") or 0), str(page[0]["id"]))
    else:
        snapshot = (0, "")
    next_cursor = None
    if has_next and page:
        last = page[-1]
        next_cursor = codec.encode(
            "datasets.list",
            context,
            cursor_filters,
            snapshot,
            (int(last.get("create_time") or 0), str(last["id"])),
            _cursor_scope_hash(prepared),
        )
    return AdapterResult(
        data=[_public_row(row) for row in page],
        meta={"limit": limit, "hasNext": has_next, "nextCursor": next_cursor},
    )


def _list_relational_resources(
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult:
    query = prepared.query
    conditions: list[Any]
    if operation == "documents.list":
        model = Document
        conditions = [Document.kb_id == str(prepared.path_args["dataset_id"]), Document.status == StatusEnum.VALID.value]
        if context.document_scope.mode in {"ids", "none"}:
            conditions.append(Document.id.in_(prepared.document_ids))
    elif operation == "chats.list":
        model = Dialog
        conditions = [
            Dialog.tenant_id == context.tenant_id,
            Dialog.status == StatusEnum.VALID.value,
            Dialog.id.in_(prepared.chat_ids),
        ]
    elif operation == "chatSessions.list":
        model = Conversation
        conditions = [Conversation.dialog_id == str(prepared.path_args["chat_id"]), Conversation.user_id == context.subject]
    elif operation == "agents.list":
        model = UserCanvas
        conditions = [
            UserCanvas.user_id == context.tenant_id,
            UserCanvas.canvas_category == "agent_canvas",
            UserCanvas.id.in_(prepared.agent_ids),
        ]
    elif operation == "agentSessions.list":
        model = API4Conversation
        conditions = [API4Conversation.dialog_id == str(prepared.path_args["agent_id"]), API4Conversation.user_id == context.subject]
    else:
        model = Memory
        conditions = [Memory.tenant_id == context.tenant_id, Memory.id.in_(prepared.memory_ids)]

    if query.get("id"):
        conditions.append(model.id == str(query["id"]))
    if query.get("ids"):
        ids = query["ids"] if isinstance(query["ids"], list) else [query["ids"]]
        conditions.append(model.id.in_(ids))
    if query.get("name") and hasattr(model, "name"):
        conditions.append(model.name == str(query["name"]))
    keywords = query.get("keywords")
    if keywords:
        text_field = model.name if hasattr(model, "name") else model.title
        conditions.append(text_field.contains(str(keywords)))
    if operation == "documents.list":
        if query.get("createTimeFrom") is not None:
            conditions.append(Document.create_time >= int(query["createTimeFrom"]))
        if query.get("createTimeTo") is not None:
            conditions.append(Document.create_time <= int(query["createTimeTo"]))
    if operation == "memories.list" and query.get("storageType"):
        conditions.append(Memory.storage_type == str(query["storageType"]))
    return _keyset_model_page(model, conditions, operation, context, prepared)


def _keyset_model_page(
    model: Any,
    conditions: list[Any],
    operation: str,
    context: RagFlowExecutionContext,
    prepared: PreparedAuthorization,
) -> AdapterResult:
    query = prepared.query
    limit = _page_limit(query.get("limit", MAX_PAGE_LIMIT))
    codec: CursorCodec = current_app.extensions["business_gateway_cursor_codec"]
    cursor_filters = _cursor_filters(prepared, query)
    decoded = codec.decode(str(query["cursor"]), operation, context, cursor_filters, _cursor_scope_hash(prepared)) if query.get("cursor") else None
    statement = model.select().where(*conditions)
    if decoded is not None:
        snapshot_time, snapshot_id = decoded.snapshot
        after_time, after_id = decoded.after
        statement = statement.where(
            ((model.create_time < snapshot_time) | ((model.create_time == snapshot_time) & (model.id <= snapshot_id)))
            & ((model.create_time < after_time) | ((model.create_time == after_time) & (model.id < after_id)))
        )
    if operation in {"chats.list", "agents.list"}:
        allowed = AuthorizationPolicy(context).dataset_ids()
        rows = []
        batch_size = max(limit * 10 + 1, 101)
        scoped_statement = statement
        while len(rows) <= limit:
            batch = list(scoped_statement.order_by(model.create_time.desc(), model.id.desc()).limit(batch_size).dicts())
            rows.extend(row for row in batch if set(_embedded_dataset_ids(row)).issubset(allowed))
            if len(batch) < batch_size:
                break
            last_raw = batch[-1]
            last_time = int(last_raw.get("create_time") or 0)
            last_id = str(last_raw["id"])
            scoped_statement = scoped_statement.where((model.create_time < last_time) | ((model.create_time == last_time) & (model.id < last_id)))
    else:
        rows = list(statement.order_by(model.create_time.desc(), model.id.desc()).limit(limit + 1).dicts())
    page = rows[:limit]
    has_next = len(rows) > limit
    snapshot = decoded.snapshot if decoded is not None else ((int(page[0].get("create_time") or 0), str(page[0]["id"])) if page else (0, ""))
    next_cursor = None
    if has_next and page:
        last = page[-1]
        next_cursor = codec.encode(operation, context, cursor_filters, snapshot, (int(last.get("create_time") or 0), str(last["id"])), _cursor_scope_hash(prepared))
    return AdapterResult(data=[_public_row(row) for row in page], meta={"limit": limit, "hasNext": has_next, "nextCursor": next_cursor})


def _cursor_scope_hash(prepared: PreparedAuthorization) -> str:
    if prepared.authorization_seal is None:
        raise RuntimeError("Business Gateway cursor requested without an authorization seal")
    return prepared.authorization_seal.scope_hash


def _cursor_filters(prepared: PreparedAuthorization, filters: dict[str, Any]) -> dict[str, Any]:
    """Bind a cursor to its parent resources and stable user filters."""

    return {
        "path": dict(prepared.path_args),
        "filters": {key: value for key, value in filters.items() if key not in {"cursor", "limit"}},
    }


def _page_limit(value: Any) -> int:
    try:
        limit = int(value)
    except (TypeError, ValueError) as error:
        raise BusinessGatewayError(
            "INVALID_REQUEST",
            f"limit must be an integer from 1 to {MAX_PAGE_LIMIT}.",
            status=400,
        ) from error
    if limit < 1 or limit > MAX_PAGE_LIMIT:
        raise BusinessGatewayError(
            "INVALID_REQUEST",
            f"limit must be an integer from 1 to {MAX_PAGE_LIMIT}.",
            status=400,
        )
    return limit


def _to_snake(value: Any) -> Any:
    if isinstance(value, dict):
        return {_snake_key(str(key)): _to_snake(member) for key, member in value.items()}
    if isinstance(value, list):
        return [_to_snake(member) for member in value]
    return value


def _to_camel(value: Any) -> Any:
    if isinstance(value, dict):
        return {_camel_key(str(key)): _to_camel(member) for key, member in value.items()}
    if isinstance(value, list):
        return [_to_camel(member) for member in value]
    return value


def _snake_key(value: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()


def _camel_key(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _active_user(user: Any) -> bool:
    return user.is_active == StatusEnum.VALID.value and user.status == StatusEnum.VALID.value
