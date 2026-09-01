#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

from typing import Any, Protocol


DEFAULT_RERANK_CANDIDATES = 64
DEFAULT_KNN_NUM_CANDIDATES = 2048

RAGFLOW_RETRIEVAL_KEYWORDS = frozenset(
    {
        "question",
        "embd_mdl",
        "tenant_ids",
        "kb_ids",
        "page",
        "page_size",
        "similarity_threshold",
        "vector_similarity_weight",
        "doc_ids",
        "aggs",
        "rerank_mdl",
        "highlight",
        "rank_feature",
        "trace_id",
        "rerank_candidates_count",
        "knn_top_k",
        "knn_num_candidates",
    }
)


class RagFlowRetriever(Protocol):
    async def retrieval(self, **kwargs: Any) -> dict[str, Any]: ...


async def invoke_ragflow_retrieval(
    retriever: RagFlowRetriever,
    *,
    question: str,
    embedding_model: Any,
    tenant_ids: list[str],
    dataset_ids: list[str],
    top_k: int,
    similarity_threshold: float,
    vector_similarity_weight: float,
    document_ids: list[str],
    rerank_model: Any,
    highlight: bool,
    rank_feature: dict[str, Any],
    trace_id: str,
) -> dict[str, Any]:
    """Invoke the current RAGFlow retrieval contract through named arguments."""

    return await retriever.retrieval(
        question=question,
        embd_mdl=embedding_model,
        tenant_ids=tenant_ids,
        kb_ids=dataset_ids,
        page=1,
        page_size=top_k,
        similarity_threshold=similarity_threshold,
        vector_similarity_weight=vector_similarity_weight,
        doc_ids=document_ids or None,
        aggs=True,
        rerank_mdl=rerank_model,
        highlight=highlight,
        rank_feature=rank_feature,
        trace_id=trace_id,
        rerank_candidates_count=max(DEFAULT_RERANK_CANDIDATES, top_k),
        knn_top_k=top_k,
        knn_num_candidates=max(DEFAULT_KNN_NUM_CANDIDATES, top_k),
    )
