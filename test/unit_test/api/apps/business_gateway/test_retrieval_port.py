#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import ast
from pathlib import Path

import pytest


pytestmark = pytest.mark.p1


class CurrentRagFlowRetriever:
    def __init__(self):
        self.arguments = None

    async def retrieval(
        self,
        *,
        question,
        embd_mdl,
        tenant_ids,
        kb_ids,
        page,
        page_size,
        similarity_threshold,
        vector_similarity_weight,
        doc_ids,
        aggs,
        rerank_mdl,
        highlight,
        rank_feature,
        trace_id,
        rerank_candidates_count,
        knn_top_k,
        knn_num_candidates,
    ):
        self.arguments = {
            "question": question,
            "embd_mdl": embd_mdl,
            "tenant_ids": tenant_ids,
            "kb_ids": kb_ids,
            "page": page,
            "page_size": page_size,
            "similarity_threshold": similarity_threshold,
            "vector_similarity_weight": vector_similarity_weight,
            "doc_ids": doc_ids,
            "aggs": aggs,
            "rerank_mdl": rerank_mdl,
            "highlight": highlight,
            "rank_feature": rank_feature,
            "trace_id": trace_id,
            "rerank_candidates_count": rerank_candidates_count,
            "knn_top_k": knn_top_k,
            "knn_num_candidates": knn_num_candidates,
        }
        return {"total": 0, "chunks": [], "doc_aggs": {}}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("top_k", "expected_rerank_candidates", "expected_knn_candidates"),
    ((32, 64, 2048), (1024, 1024, 2048), (4096, 4096, 4096)),
)
async def test_retrieval_port_uses_current_ragflow_named_contract(
    gateway_modules,
    top_k,
    expected_rerank_candidates,
    expected_knn_candidates,
):
    module = gateway_modules("retrieval_port")
    retriever = CurrentRagFlowRetriever()
    embedding_model = object()
    rerank_model = object()

    result = await module.invoke_ragflow_retrieval(
        retriever,
        question="Where is the policy?",
        embedding_model=embedding_model,
        tenant_ids=["tenant-a"],
        dataset_ids=["dataset-a"],
        top_k=top_k,
        similarity_threshold=0.42,
        vector_similarity_weight=0.7,
        document_ids=["document-a"],
        rerank_model=rerank_model,
        highlight=True,
        rank_feature={"pagerank_fea": 10},
        trace_id="request-a",
    )

    assert result == {"total": 0, "chunks": [], "doc_aggs": {}}
    assert retriever.arguments == {
        "question": "Where is the policy?",
        "embd_mdl": embedding_model,
        "tenant_ids": ["tenant-a"],
        "kb_ids": ["dataset-a"],
        "page": 1,
        "page_size": top_k,
        "similarity_threshold": 0.42,
        "vector_similarity_weight": 0.7,
        "doc_ids": ["document-a"],
        "aggs": True,
        "rerank_mdl": rerank_model,
        "highlight": True,
        "rank_feature": {"pagerank_fea": 10},
        "trace_id": "request-a",
        "rerank_candidates_count": expected_rerank_candidates,
        "knn_top_k": top_k,
        "knn_num_candidates": expected_knn_candidates,
    }


@pytest.mark.asyncio
async def test_retrieval_port_omits_empty_document_scope(gateway_modules):
    module = gateway_modules("retrieval_port")
    retriever = CurrentRagFlowRetriever()

    await module.invoke_ragflow_retrieval(
        retriever,
        question="Question",
        embedding_model=object(),
        tenant_ids=["tenant-a"],
        dataset_ids=["dataset-a"],
        top_k=64,
        similarity_threshold=0.2,
        vector_similarity_weight=0.3,
        document_ids=[],
        rerank_model=None,
        highlight=False,
        rank_feature={},
        trace_id="request-a",
    )

    assert retriever.arguments["doc_ids"] is None


def test_retrieval_port_keywords_exist_in_current_ragflow_contract(gateway_modules):
    module = gateway_modules("retrieval_port")
    root = Path(__file__).resolve().parents[5]
    tree = ast.parse((root / "rag" / "nlp" / "search.py").read_text(encoding="utf-8"))
    dealer = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Dealer")
    retrieval = next(node for node in dealer.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "retrieval")
    parameters = {
        argument.arg
        for argument in (
            *retrieval.args.posonlyargs,
            *retrieval.args.args,
            *retrieval.args.kwonlyargs,
        )
    }
    positional = [*retrieval.args.posonlyargs, *retrieval.args.args]
    missing = object()
    positional_defaults = [missing] * (len(positional) - len(retrieval.args.defaults)) + list(retrieval.args.defaults)
    required = {argument.arg for argument, default in zip(positional, positional_defaults, strict=True) if default is missing}
    required.update(argument.arg for argument, default in zip(retrieval.args.kwonlyargs, retrieval.args.kw_defaults, strict=True) if default is None)
    required.discard("self")

    assert module.RAGFLOW_RETRIEVAL_KEYWORDS <= parameters
    assert required <= module.RAGFLOW_RETRIEVAL_KEYWORDS


def test_business_adapter_routes_retrieval_through_the_contract_port():
    root = Path(__file__).resolve().parents[5]
    source = (root / "api" / "apps" / "business_gateway" / "adapter.py").read_text(encoding="utf-8")

    assert "invoke_ragflow_retrieval(" in source
    assert "settings.retriever.retrieval(" not in source
