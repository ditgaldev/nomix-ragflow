#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Configure, observe, and query PageIndex through native RAGFlow services."""

from __future__ import annotations

import json
import logging
from copy import deepcopy
from typing import Any

from api.apps.services import structure_graph_common as sgc
from api.db.joint_services.tenant_model_service import resolve_model_config
from api.db.services.compilation_template_group_service import CompilationTemplateGroupService
from api.db.services.compilation_template_service import CompilationTemplateService
from api.db.services.document_service import DocumentService
from api.db.services.tenant_llm_service import TenantLLMService
from common import settings
from common.constants import LLMType, TaskStatus
from common.doc_store.doc_store_base import OrderByExpr
from common.misc_utils import thread_pool_exec
from rag.nlp import search

MAX_PAGE_INDEX_DOCUMENTS = 20
MAX_PAGE_INDEX_CHUNKS = 100
_LOG = logging.getLogger(__name__)
_PAGE_INDEX_GROUP_NAME = "PageIndex"
_MAX_STATUS_MESSAGE_CHARS = 1000


def _kind(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", "_")


def _template_id(row: dict) -> str | None:
    value = row.get("compilation_template_ids")
    if isinstance(value, list):
        value = next((item for item in value if isinstance(item, str) and item.strip()), None)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _group_ids(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(item.strip() for item in value if isinstance(item, str) and item.strip()))


def ensure_page_index_group(tenant_id: str) -> dict:
    """Reuse or create a normal RAGFlow file-scope PageIndex template group."""
    groups = CompilationTemplateGroupService.list_saved(tenant_id)
    page_index_groups = [group for group in groups if len(group.get("templates") or []) == 1 and _kind((group.get("templates") or [{}])[0].get("kind")) in {"page_index", "pageindex"}]
    if page_index_groups:
        return next((group for group in page_index_groups if group.get("name") == _PAGE_INDEX_GROUP_NAME), page_index_groups[0])
    if any(group.get("name") == _PAGE_INDEX_GROUP_NAME for group in groups):
        raise ValueError(f"Compilation group '{_PAGE_INDEX_GROUP_NAME}' exists but is not a PageIndex group.")

    builtin = next(
        (template for template in CompilationTemplateService.list_builtins() if _kind(template.get("kind")) in {"page_index", "pageindex"}),
        None,
    )
    if builtin is None:
        raise ValueError("The built-in PageIndex compilation template is unavailable.")
    return CompilationTemplateGroupService.create_group(
        tenant_id,
        _PAGE_INDEX_GROUP_NAME,
        builtin.get("description") or "RAGFlow PageIndex compilation template.",
        [
            {
                "name": builtin.get("display_name") or "PageIndex",
                "description": builtin.get("description") or "",
                "kind": "page_index",
                "config": deepcopy(builtin.get("config") or {}),
            }
        ],
    )


def configure_page_index(tenant_id: str, documents: list[Any]) -> str:
    """Attach a standard RAGFlow PageIndex group without discarding existing groups."""
    group = ensure_page_index_group(tenant_id)
    group_id = str(group["id"])
    for document in documents:
        parser_config = deepcopy(document.parser_config or {})
        ext = parser_config.get("ext") if isinstance(parser_config.get("ext"), dict) else {}
        if "compilation_template_group_id" in parser_config:
            existing = _group_ids(parser_config.get("compilation_template_group_id"))
        else:
            existing = _group_ids(ext.get("compilation_template_group_id"))
        parser_config["compilation_template_group_id"] = list(dict.fromkeys([*existing, group_id]))
        if "compilation_template_group_id" in ext:
            ext = dict(ext)
            ext["compilation_template_group_id"] = parser_config["compilation_template_group_id"]
            parser_config["ext"] = ext
        DocumentService.update_by_id(document.id, {"parser_config": parser_config})
        # DocumentService.run consumes the already-loaded row immediately
        # after this call, so keep that in-memory snapshot authoritative too.
        document.parser_config = parser_config
    return group_id


async def has_page_index(tenant_id: str, dataset_id: str, document_id: str) -> bool:
    return bool(await _readable_page_index_buckets(tenant_id, dataset_id, document_id))


def is_page_index_configured(document: Any, tenant_id: str) -> bool:
    parser_config = document.parser_config or {}
    ext = parser_config.get("ext") if isinstance(parser_config.get("ext"), dict) else {}
    if "compilation_template_group_id" in parser_config:
        configured_group_ids = set(_group_ids(parser_config.get("compilation_template_group_id")))
    else:
        configured_group_ids = set(_group_ids(ext.get("compilation_template_group_id")))
    return any(
        str(group.get("id")) in configured_group_ids and any(_kind(template.get("kind")) in {"page_index", "pageindex"} for template in group.get("templates") or [])
        for group in CompilationTemplateGroupService.list_saved(tenant_id)
    )


def page_index_status(document: Any, available: bool, tenant_id: str) -> dict[str, Any]:
    """Project native RAGFlow document state and PageIndex artifacts."""
    run = str(document.run or "")
    progress = float(document.progress or 0)
    updated_at = getattr(document, "update_time", None)
    configured = is_page_index_configured(document, tenant_id)
    if not configured and not available:
        state, phase, error_code, error_message = "not_configured", None, None, None
    elif run in {TaskStatus.RUNNING.value, TaskStatus.SCHEDULE.value}:
        state, phase, error_code, error_message = "running", "parse", None, None
    elif run == TaskStatus.CANCEL.value:
        state, phase, error_code, error_message = "cancelled", "cancelled", "CANCELLED", "RAGFlow parsing was cancelled."
    elif run == TaskStatus.FAIL.value or progress < 0:
        message = str(document.progress_msg or "RAGFlow parsing failed.")[-_MAX_STATUS_MESSAGE_CHARS:]
        state, phase, error_code, error_message = "failed", "parse", "RAGFLOW_PARSE_FAILED", message
    elif available:
        state, phase, error_code, error_message = "ready", "complete", None, None
    elif run == TaskStatus.DONE.value:
        state, phase = "failed", "materialize"
        error_code = "MATERIALIZATION_MISSING"
        error_message = "RAGFlow parsing completed without a readable PageIndex chapter tree."
    else:
        state, phase, error_code, error_message = "pending", "configured", None, None
    return {
        "run": run,
        "progress": progress,
        "progressMessage": str(document.progress_msg or "")[-_MAX_STATUS_MESSAGE_CHARS:],
        "state": state,
        "phase": phase,
        "errorCode": error_code,
        "errorMessage": error_message,
        "updatedAt": updated_at,
    }


async def _page_index_buckets(tenant_id: str, dataset_id: str, document_id: str) -> list[dict]:
    fields = ["compile_kwd", "compilation_template_ids", "compilation_template_kind_kwd"]
    result = await thread_pool_exec(
        settings.docStoreConn.search,
        fields,
        [],
        {"doc_id": [document_id], "knowledge_graph_kwd": ["graph"]},
        [],
        OrderByExpr(),
        0,
        1000,
        search.index_name(tenant_id),
        [dataset_id],
    )
    rows = settings.docStoreConn.get_fields(result, fields) or {}
    buckets: list[dict] = []
    seen: set[str] = set()
    for row in rows.values():
        template_id = _template_id(row)
        compile_kwd = str(row.get("compile_kwd") or "").strip()
        raw_kind = row.get("compilation_template_kind_kwd") or compile_kwd
        template_name = template_id or f"PageIndex ({compile_kwd})"
        if template_id:
            saved = CompilationTemplateService.get_saved(template_id, tenant_id)
            if saved:
                raw_kind = saved.get("kind") or raw_kind
                template_name = saved.get("name") or template_name
        if _kind(raw_kind) not in {"page_index", "pageindex"}:
            continue
        bucket_id = template_id or f"legacy:{compile_kwd}"
        if bucket_id in seen:
            continue
        seen.add(bucket_id)
        scope = {"doc_id": [document_id]}
        if template_id:
            scope["compilation_template_ids"] = [template_id]
        else:
            scope.update({"compile_kwd": [compile_kwd], "must_not": {"exists": "compilation_template_ids"}})
        buckets.append(
            {
                "template_id": bucket_id,
                "template_name": template_name,
                "kind": "page_index",
                "scope": scope,
            }
        )
    return buckets


def _public_entity(entity: dict) -> dict:
    raw_source_ids = entity.get("source_chunk_ids") or []
    if isinstance(raw_source_ids, str):
        raw_source_ids = [raw_source_ids]
    source_ids = [value for value in raw_source_ids if isinstance(value, str) and value]
    return {
        "name": str(entity.get("name") or ""),
        "type": str(entity.get("type") or ""),
        "description": str(entity.get("description") or ""),
        "sourceChunkIds": source_ids,
    }


def _public_relation(relation: dict) -> dict:
    return {
        "from": str(relation.get("from") or ""),
        "to": str(relation.get("to") or ""),
        "type": str(relation.get("type") or "include"),
    }


async def _page_index_chunk_order(tenant_id: str, dataset_id: str, document_id: str) -> dict[str, int]:
    try:
        result = await settings.retriever.search(
            {
                "doc_ids": [document_id],
                "page": 1,
                "size": 10000,
                "question": "",
                "sort": True,
                "must_not": {"exists": "compile_kwd"},
            },
            search.index_name(tenant_id),
            [dataset_id],
            emb_mdl=None,
            highlight=True,
        )
    except Exception:  # noqa: BLE001 - optional ordering must not break PageIndex reads
        _LOG.exception("PageIndex chunk ordering failed for document %s", document_id)
        return {}
    return {str(chunk_id): index for index, chunk_id in enumerate(result.ids or []) if str(chunk_id)}


def _order_entities(entities: list[dict], chunk_order: dict[str, int]) -> list[dict]:
    def position(entity: dict, fallback: int) -> tuple[float | int, int]:
        source_ids = entity.get("source_chunk_ids") or []
        if isinstance(source_ids, str):
            source_ids = [source_ids]
        indexes = [chunk_order[source_id] for source_id in source_ids if isinstance(source_id, str) and source_id in chunk_order]
        return (min(indexes), fallback) if indexes else (float("inf"), fallback)

    return [entity for fallback, entity in sorted(enumerate(entities), key=lambda item: position(item[1], item[0]))]


async def get_page_index(tenant_id: str, dataset_id: str, document_id: str) -> dict:
    """Return all compiled PageIndex templates for one authorized document."""
    chunk_order = await _page_index_chunk_order(tenant_id, dataset_id, document_id)
    templates = []
    for bucket, entities, relations in await _readable_page_index_buckets(tenant_id, dataset_id, document_id):
        templates.append(
            {
                "templateId": bucket["template_id"],
                "templateName": bucket["template_name"],
                "kind": "page_index",
                "entities": [_public_entity(entity) for entity in _order_entities(entities, chunk_order)],
                "relations": [_public_relation(relation) for relation in relations],
            }
        )
    return {"datasetId": dataset_id, "documentId": document_id, "templates": templates}


async def _readable_page_index_buckets(tenant_id: str, dataset_id: str, document_id: str) -> list[tuple[dict, list[dict], list[dict]]]:
    """Return PageIndex buckets only when their compiled graph has readable nodes."""
    index_name = search.index_name(tenant_id)
    readable = []
    for bucket in await _page_index_buckets(tenant_id, dataset_id, document_id):
        entities, relations = await _load_complete_graph(index_name, dataset_id, bucket["scope"])
        if entities:
            readable.append((bucket, entities, relations))
    return readable


async def _load_complete_graph(index_name: str, dataset_id: str, scope: dict) -> tuple[list[dict], list[dict]]:
    """Load complete compact graph blobs; Agent spill limits bound large responses."""
    fields = ["content_with_weight"]
    result = await thread_pool_exec(
        settings.docStoreConn.search,
        fields,
        [],
        dict(scope, knowledge_graph_kwd=["graph"]),
        [],
        OrderByExpr(),
        0,
        1000,
        index_name,
        [dataset_id],
    )
    rows = settings.docStoreConn.get_fields(result, fields) or {}
    entities: list[dict] = []
    relations: list[dict] = []
    for row in rows.values():
        try:
            graph = json.loads(row.get("content_with_weight") or "{}")
        except (TypeError, ValueError):
            continue
        if not isinstance(graph, dict):
            continue
        entities.extend(value for value in graph.get("entities") or [] if isinstance(value, dict))
        relations.extend(value for value in graph.get("relations") or [] if isinstance(value, dict))
    entities = sgc.dedup_entities(entities)
    deduplicated_relations: list[dict] = []
    seen_relations: set[tuple[str, str, str]] = set()
    for relation in relations:
        key = (str(relation.get("from") or ""), str(relation.get("to") or ""), str(relation.get("type") or "include"))
        if not key[0] or not key[1] or key in seen_relations:
            continue
        seen_relations.add(key)
        deduplicated_relations.append(relation)
    return entities, sgc.normalize_relation_endpoints(entities, deduplicated_relations)


async def _embedding_model(tenant_id: str, document_id: str):
    try:
        embedding_id = DocumentService.get_embd_id(document_id)
        config = resolve_model_config(tenant_id, LLMType.EMBEDDING.value, embedding_id)
        return TenantLLMService.model_instance(config)
    except Exception:  # noqa: BLE001 - lexical matching remains available without embeddings
        _LOG.exception("PageIndex embedding model binding failed for document %s", document_id)
        return None


async def _load_chunks(tenant_id: str, dataset_id: str, document_id: str, chunk_ids: list[str]) -> list[dict]:
    if not chunk_ids:
        return []
    fields = ["content_with_weight", "docnm_kwd", "doc_id", "kb_id"]
    result = await thread_pool_exec(
        settings.docStoreConn.search,
        fields,
        [],
        {"id": chunk_ids, "doc_id": [document_id]},
        [],
        OrderByExpr(),
        0,
        len(chunk_ids),
        search.index_name(tenant_id),
        [dataset_id],
    )
    rows = settings.docStoreConn.get_fields(result, fields) or {}
    chunks_by_id = {
        str(chunk_id): {
            "id": str(chunk_id),
            "content": str(row.get("content_with_weight") or ""),
            "datasetId": str(row.get("kb_id") or dataset_id),
            "documentId": str(row.get("doc_id") or document_id),
            "documentName": str(row.get("docnm_kwd") or ""),
        }
        for chunk_id, row in rows.items()
    }
    return [chunks_by_id[chunk_id] for chunk_id in chunk_ids if chunk_id in chunks_by_id]


async def search_page_index(document_scopes: list[tuple[str, str, str]], question: str, limit: int) -> dict:
    """Route a question through PageIndex nodes and return their source chunks."""
    if len(document_scopes) > MAX_PAGE_INDEX_DOCUMENTS:
        raise ValueError(f"PageIndex search accepts at most {MAX_PAGE_INDEX_DOCUMENTS} documents.")
    limit = max(1, min(int(limit), MAX_PAGE_INDEX_CHUNKS))
    chunks: list[dict] = []
    navigation_documents: list[dict] = []
    seen_chunks: set[tuple[str, str]] = set()
    source_ids_by_document: dict[tuple[str, str, str], list[str]] = {}

    for tenant_id, dataset_id, document_id in document_scopes:
        index_name = search.index_name(tenant_id)
        buckets = await _readable_page_index_buckets(tenant_id, dataset_id, document_id)
        document_trace = {"datasetId": dataset_id, "documentId": document_id, "pageIndexAvailable": False, "paths": []}
        if not buckets:
            navigation_documents.append(document_trace)
            continue
        model = await _embedding_model(tenant_id, document_id)
        for bucket, _, _ in buckets:
            document_trace["pageIndexAvailable"] = True

            def resolve_bucket(_row, current=bucket):
                return (
                    {"template_id": current["template_id"], "template_name": current["template_name"], "kind": "page_index"},
                    current["scope"],
                )

            meta, entities, relations = await sgc.keyword_subgraph(
                index_name,
                dataset_id,
                model,
                dict(bucket["scope"], knowledge_graph_kwd=["entity"]),
                question,
                resolve_bucket,
                log_ctx=f"page-index doc={document_id}",
            )
            if not meta:
                continue
            public_entities = [_public_entity(entity) for entity in entities]
            document_trace["paths"].append(
                {
                    "templateId": bucket["template_id"],
                    "templateName": bucket["template_name"],
                    "entities": public_entities,
                    "relations": [_public_relation(relation) for relation in relations],
                }
            )
            source_ids: list[str] = []
            for entity in public_entities:
                for chunk_id in entity["sourceChunkIds"]:
                    key = (document_id, chunk_id)
                    if key not in seen_chunks:
                        seen_chunks.add(key)
                        if len(source_ids) < limit:
                            source_ids.append(chunk_id)
            source_ids_by_document.setdefault((tenant_id, dataset_id, document_id), []).extend(source_ids)
        navigation_documents.append(document_trace)

    selected_by_document: dict[tuple[str, str, str], list[str]] = {scope: [] for scope in source_ids_by_document}
    pending = {scope: list(source_ids) for scope, source_ids in source_ids_by_document.items()}
    while sum(len(values) for values in selected_by_document.values()) < limit and any(pending.values()):
        for scope, source_ids in pending.items():
            if source_ids:
                selected_by_document[scope].append(source_ids.pop(0))
                if sum(len(values) for values in selected_by_document.values()) >= limit:
                    break
    for (tenant_id, dataset_id, document_id), source_ids in selected_by_document.items():
        chunks.extend(await _load_chunks(tenant_id, dataset_id, document_id, source_ids))

    doc_aggs: dict[str, dict] = {}
    for chunk in chunks:
        doc_id = chunk["documentId"]
        aggregate = doc_aggs.setdefault(doc_id, {"documentId": doc_id, "documentName": chunk.get("documentName", ""), "chunkCount": 0})
        aggregate["chunkCount"] += 1
    return {
        "chunks": chunks,
        "total": len(chunks),
        "docAggs": list(doc_aggs.values()),
        "navigation": {"documents": navigation_documents, "fallbackUsed": False},
    }
