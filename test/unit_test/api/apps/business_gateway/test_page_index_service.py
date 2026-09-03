#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import sys
import uuid
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest


class TaskStatus:
    UNSTART = SimpleNamespace(value="0")
    RUNNING = SimpleNamespace(value="1")
    CANCEL = SimpleNamespace(value="2")
    DONE = SimpleNamespace(value="3")
    FAIL = SimpleNamespace(value="4")
    SCHEDULE = SimpleNamespace(value="5")


@pytest.fixture
def page_index_service(monkeypatch):
    """Load the Gateway module with only its native interfaces stubbed."""

    def stub(name: str, **members):
        module = ModuleType(name)
        for key, value in members.items():
            setattr(module, key, value)
        monkeypatch.setitem(sys.modules, name, module)
        return module

    service = type(
        "Service",
        (),
        {
            "create_group": None,
            "get_embd_id": None,
            "get_saved": None,
            "list_builtins": None,
            "list_saved": None,
            "model_instance": None,
            "update_by_id": None,
        },
    )
    sgc = SimpleNamespace(
        dedup_entities=lambda values: values,
        normalize_relation_endpoints=lambda _entities, relations: relations,
        keyword_subgraph=None,
    )
    stub("api.apps.services", structure_graph_common=sgc)
    stub("api.db.joint_services.tenant_model_service", resolve_model_config=lambda *_args: None)
    stub("api.db.services.compilation_template_group_service", CompilationTemplateGroupService=service)
    stub("api.db.services.compilation_template_service", CompilationTemplateService=service)
    stub("api.db.services.document_service", DocumentService=service)
    stub("api.db.services.tenant_llm_service", TenantLLMService=service)
    settings = SimpleNamespace()
    common = stub("common", settings=settings)
    common.__path__ = []
    stub("common.constants", LLMType=SimpleNamespace(EMBEDDING=SimpleNamespace(value="embedding")), TaskStatus=TaskStatus)
    stub("common.doc_store.doc_store_base", OrderByExpr=type("OrderByExpr", (), {}))
    stub("common.misc_utils", thread_pool_exec=None)
    search = SimpleNamespace(index_name=lambda tenant_id: f"index-{tenant_id}")
    stub("rag.nlp", search=search)

    root = Path(__file__).resolve().parents[5]
    module_name = f"_page_index_service_unit_{uuid.uuid4().hex}"
    spec = spec_from_file_location(module_name, root / "api" / "apps" / "business_gateway" / "page_index_service.py")
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    monkeypatch.setitem(sys.modules, module_name, module)
    spec.loader.exec_module(module)
    return module


@pytest.mark.p1
def test_ensure_page_index_group_creates_from_builtin_template(monkeypatch, page_index_service):
    created = []
    monkeypatch.setattr(page_index_service.CompilationTemplateGroupService, "list_saved", lambda _tenant_id: [])
    monkeypatch.setattr(
        page_index_service.CompilationTemplateService,
        "list_builtins",
        lambda: [{"kind": "page_index", "display_name": "PageIndex", "description": "tree", "config": {"kind": "page_index"}}],
    )
    monkeypatch.setattr(
        page_index_service.CompilationTemplateGroupService,
        "create_group",
        lambda *args: created.append(args) or {"id": "page-index-group", "templates": [{"kind": "page_index"}]},
    )

    result = page_index_service.ensure_page_index_group("tenant-1")

    assert result["id"] == "page-index-group"
    assert created[0][0:3] == (
        "tenant-1",
        "PageIndex",
        "tree",
    )
    assert created[0][3] == [
        {
            "name": "PageIndex",
            "description": "tree",
            "kind": "page_index",
            "config": {"kind": "page_index"},
        }
    ]


@pytest.mark.p1
def test_configure_page_index_preserves_existing_compilation_groups(monkeypatch, page_index_service):
    document = SimpleNamespace(
        id="doc-1",
        parser_config={
            "chunk_token_num": 512,
            "compilation_template_group_id": ["existing-top"],
            "ext": {"compilation_template_group_id": "existing-ext", "layout": "manual"},
        },
    )
    updates = []
    monkeypatch.setattr(page_index_service, "ensure_page_index_group", lambda _tenant_id: {"id": "page-index-group"})
    monkeypatch.setattr(page_index_service.DocumentService, "update_by_id", lambda document_id, values: updates.append((document_id, values)))

    group_id = page_index_service.configure_page_index("tenant-1", [document])

    assert group_id == "page-index-group"
    assert updates == [
        (
            "doc-1",
            {
                "parser_config": {
                    "chunk_token_num": 512,
                    "compilation_template_group_id": ["existing-top", "page-index-group"],
                    "ext": {
                        "compilation_template_group_id": ["existing-top", "page-index-group"],
                        "layout": "manual",
                    },
                }
            },
        )
    ]
    assert document.parser_config == updates[0][1]["parser_config"]


@pytest.mark.p1
def test_page_index_status_projects_native_ragflow_state(monkeypatch, page_index_service):
    document = SimpleNamespace(
        id="doc-1",
        parser_config={"compilation_template_group_id": ["page-index-group"]},
        run=TaskStatus.FAIL.value,
        progress=-1,
        progress_msg="parse failed",
        update_time=42,
    )
    monkeypatch.setattr(
        page_index_service.CompilationTemplateGroupService,
        "list_saved",
        lambda _tenant_id: [{"id": "page-index-group", "templates": [{"kind": "page_index"}]}],
    )

    assert page_index_service.page_index_status(document, False, "tenant-1") == {
        "run": TaskStatus.FAIL.value,
        "progress": -1.0,
        "progressMessage": "parse failed",
        "state": "failed",
        "phase": "parse",
        "errorCode": "RAGFLOW_PARSE_FAILED",
        "errorMessage": "parse failed",
        "updatedAt": 42,
    }
    assert page_index_service.page_index_status(document, True, "tenant-1") == {
        "run": TaskStatus.FAIL.value,
        "progress": -1.0,
        "progressMessage": "parse failed",
        "state": "failed",
        "phase": "parse",
        "errorCode": "RAGFLOW_PARSE_FAILED",
        "errorMessage": "parse failed",
        "updatedAt": 42,
    }


@pytest.mark.p1
def test_page_index_status_detects_configured_page_index_group(monkeypatch, page_index_service):
    document = SimpleNamespace(parser_config={"compilation_template_group_id": ["page-index-group"]}, run=TaskStatus.UNSTART.value, progress=0, progress_msg="", update_time=42)
    monkeypatch.setattr(
        page_index_service.CompilationTemplateGroupService,
        "list_saved",
        lambda _tenant_id: [{"id": "page-index-group", "templates": [{"kind": "page_index"}]}],
    )

    status = page_index_service.page_index_status(document, False, "tenant-1")
    assert status["state"] == "pending"
    assert status["phase"] == "configured"
    document.run = TaskStatus.DONE.value
    document.progress = 1
    assert page_index_service.page_index_status(document, True, "tenant-1")["state"] == "ready"


@pytest.mark.p1
@pytest.mark.asyncio
async def test_page_index_availability_requires_a_readable_nonempty_tree(monkeypatch, page_index_service):
    broken_scope = {"doc_id": ["doc-1"], "compilation_template_ids": ["broken"]}
    valid_scope = {"doc_id": ["doc-1"], "compilation_template_ids": ["valid"]}

    async def buckets(*_args):
        return [{"scope": broken_scope}, {"scope": valid_scope}]

    loaded_scopes = []

    async def load_graph(_index_name, _dataset_id, scope):
        loaded_scopes.append(scope)
        return ([{"name": "Root"}], []) if scope == valid_scope else ([], [])

    monkeypatch.setattr(page_index_service, "_page_index_buckets", buckets)
    monkeypatch.setattr(page_index_service, "_load_complete_graph", load_graph)
    monkeypatch.setattr(page_index_service.search, "index_name", lambda _tenant_id: "index")

    assert await page_index_service.has_page_index("tenant-1", "dataset-1", "doc-1")
    assert loaded_scopes == [broken_scope, valid_scope]


@pytest.mark.p1
@pytest.mark.asyncio
async def test_get_page_index_projects_only_the_public_tree_shape(monkeypatch, page_index_service):
    async def buckets(*_args):
        return [{"template_id": "template-1", "template_name": "PageIndex", "kind": "page_index", "scope": {"doc_id": ["doc-1"]}}]

    async def load_complete_graph(*_args):
        return (
            [
                {"name": "Appendix", "type": "title", "description": "Reference", "source_chunk_ids": "chunk-2", "private": True},
                {"name": "Deployment", "type": "title", "description": "How to deploy", "source_chunk_ids": "chunk-1", "private": True},
            ],
            [{"from": "Root", "to": "Deployment", "type": "include", "private": True}],
        )

    monkeypatch.setattr(page_index_service, "_page_index_buckets", buckets)
    monkeypatch.setattr(page_index_service, "_load_complete_graph", load_complete_graph)
    monkeypatch.setattr(page_index_service, "_page_index_chunk_order", lambda *_args: _async_value({"chunk-1": 0, "chunk-2": 1}))
    monkeypatch.setattr(page_index_service.search, "index_name", lambda _tenant_id: "index")

    result = await page_index_service.get_page_index("tenant-1", "dataset-1", "doc-1")

    assert result == {
        "datasetId": "dataset-1",
        "documentId": "doc-1",
        "templates": [
            {
                "templateId": "template-1",
                "templateName": "PageIndex",
                "kind": "page_index",
                "entities": [
                    {"name": "Deployment", "type": "title", "description": "How to deploy", "sourceChunkIds": ["chunk-1"]},
                    {"name": "Appendix", "type": "title", "description": "Reference", "sourceChunkIds": ["chunk-2"]},
                ],
                "relations": [{"from": "Root", "to": "Deployment", "type": "include"}],
            }
        ],
    }


@pytest.mark.p1
@pytest.mark.asyncio
async def test_search_page_index_returns_paths_and_deduplicated_source_chunks(monkeypatch, page_index_service):
    bucket = {"template_id": "template-1", "template_name": "PageIndex", "kind": "page_index", "scope": {"doc_id": ["doc-1"]}}

    async def buckets(*_args):
        return [bucket]

    async def keyword_subgraph(*_args, **_kwargs):
        return (
            {"template_id": "template-1"},
            [
                {"name": "Root", "type": "title", "description": "", "source_chunk_ids": ["chunk-1"]},
                {"name": "Deployment", "type": "fact", "description": "", "source_chunk_ids": ["chunk-1", "chunk-2"]},
            ],
            [{"from": "Root", "to": "Deployment", "type": "include"}],
        )

    async def chunks(_tenant_id, _dataset_id, _document_id, chunk_ids):
        return [
            {
                "id": chunk_id,
                "content": chunk_id,
                "datasetId": "dataset-1",
                "documentId": "doc-1",
                "documentName": "Guide",
            }
            for chunk_id in chunk_ids
        ]

    monkeypatch.setattr(page_index_service, "_page_index_buckets", buckets)
    monkeypatch.setattr(page_index_service, "_load_complete_graph", lambda *_args: _async_value(([{"name": "Root"}], [])))
    monkeypatch.setattr(page_index_service, "_embedding_model", lambda *_args: _async_value(object()))
    monkeypatch.setattr(page_index_service, "_load_chunks", chunks)
    monkeypatch.setattr(page_index_service.sgc, "keyword_subgraph", keyword_subgraph)
    monkeypatch.setattr(page_index_service.search, "index_name", lambda _tenant_id: "index")

    result = await page_index_service.search_page_index([("tenant-1", "dataset-1", "doc-1")], "deployment", 10)

    assert [chunk["id"] for chunk in result["chunks"]] == ["chunk-1", "chunk-2"]
    assert result["total"] == 2
    assert result["docAggs"] == [{"documentId": "doc-1", "documentName": "Guide", "chunkCount": 2}]
    assert result["navigation"]["fallbackUsed"] is False
    assert result["navigation"]["documents"][0]["paths"][0]["entities"][1]["name"] == "Deployment"


@pytest.mark.p1
@pytest.mark.asyncio
async def test_search_page_index_reports_unreadable_tree_as_unavailable(monkeypatch, page_index_service):
    bucket = {"template_id": "template-1", "template_name": "PageIndex", "kind": "page_index", "scope": {"doc_id": ["doc-1"]}}

    monkeypatch.setattr(page_index_service, "_page_index_buckets", lambda *_args: _async_value([bucket]))
    monkeypatch.setattr(page_index_service, "_load_complete_graph", lambda *_args: _async_value(([], [])))

    result = await page_index_service.search_page_index([("tenant-1", "dataset-1", "doc-1")], "deployment", 10)

    assert result == {
        "chunks": [],
        "total": 0,
        "docAggs": [],
        "navigation": {
            "documents": [{"datasetId": "dataset-1", "documentId": "doc-1", "pageIndexAvailable": False, "paths": []}],
            "fallbackUsed": False,
        },
    }


async def _async_value(value):
    return value
