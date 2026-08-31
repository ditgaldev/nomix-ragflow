#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Business-subject isolation for RAGFlow Memory without changing Memory APIs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from api.db.db_models import Memory
from api.db.services.canvas_service import UserCanvasService
from api.db.services.task_service import TaskService
from common import settings
from common.constants import MemoryType
from common.doc_store.doc_store_base import OrderByExpr
from common.time_utils import current_timestamp, timestamp_to_date
from memory.services.messages import MessageService, index_name

from .errors import BusinessGatewayError, resource_not_found

_MESSAGE_FIELDS = [
    "message_id",
    "message_type",
    "source_id",
    "memory_id",
    "user_id",
    "agent_id",
    "session_id",
    "valid_at",
    "invalid_at",
    "forget_at",
    "status",
]
_CONTENT_FIELDS = [*_MESSAGE_FIELDS, "content"]
MAX_MEMORY_MESSAGE_SCAN = 10_000


@dataclass(frozen=True)
class SubjectMessagePage:
    data: dict[str, Any]
    snapshot: tuple[int, str]
    after: tuple[int, str]
    has_next: bool


def list_subject_messages(
    memory_id: str,
    tenant_id: str,
    subject: str,
    limit: int,
    request_id: str,
    *,
    snapshot: tuple[int, str] | None = None,
    after: tuple[int, str] | None = None,
) -> SubjectMessagePage:
    memory = _memory(memory_id, tenant_id, request_id)
    order_by = OrderByExpr().desc("message_id")
    scan_limit = min(max(limit + 1, 100), MAX_MEMORY_MESSAGE_SCAN)
    total = 0
    keyed: list[tuple[tuple[int, str], dict[str, Any]]] = []
    while True:
        result, total = settings.msgStoreConn.search(
            select_fields=_MESSAGE_FIELDS,
            highlight_fields=[],
            condition={"message_type": MemoryType.RAW.name.lower(), "user_id": subject},
            match_expressions=[],
            order_by=order_by,
            offset=0,
            limit=scan_limit,
            index_names=index_name(tenant_id),
            memory_ids=[memory_id],
            agg_fields=[],
            hide_forgotten=False,
        )
        rows = list((settings.msgStoreConn.get_fields(result, _MESSAGE_FIELDS) or {}).values()) if total else []
        by_id = {str(row.get("message_id")): row for row in rows}
        keyed = sorted(
            [(_message_key(row, request_id), row) for row in by_id.values()],
            reverse=True,
        )
        effective_snapshot = snapshot if snapshot is not None else (keyed[0][0] if keyed else (0, ""))
        eligible = [item for item in keyed if item[0] <= effective_snapshot and (after is None or item[0] < after)]
        # Some RAGFlow Memory backends return a true total while others return
        # only the current result count.  Row exhaustion is the portable signal.
        if len(eligible) > limit or len(rows) < scan_limit:
            break
        if scan_limit >= MAX_MEMORY_MESSAGE_SCAN:
            raise BusinessGatewayError(
                "CURSOR_WINDOW_EXCEEDED",
                "The memory message cursor exceeded the bounded Gateway scan window.",
                status=503,
                request_id=request_id,
                retryable=False,
            )
        scan_limit = min(scan_limit * 2, MAX_MEMORY_MESSAGE_SCAN)

    page = eligible[:limit]
    messages = [message for _, message in page]
    has_next = len(eligible) > limit
    effective_after = page[-1][0] if page else (after or effective_snapshot)
    source_ids = [message["message_id"] for message in messages]
    extracts: dict[str, list[dict[str, Any]]] = {}
    if source_ids:
        extract_result, _ = settings.msgStoreConn.search(
            select_fields=_MESSAGE_FIELDS,
            highlight_fields=[],
            condition={"source_id": source_ids, "user_id": subject},
            match_expressions=[],
            order_by=order_by,
            offset=0,
            limit=min(max(limit * 10, 100), 1_000),
            index_names=index_name(tenant_id),
            memory_ids=[memory_id],
            agg_fields=[],
            hide_forgotten=False,
        )
        for message in (settings.msgStoreConn.get_fields(extract_result, _MESSAGE_FIELDS) or {}).values():
            extracts.setdefault(str(message.get("source_id")), []).append(message)

    agent_ids = [str(message.get("agent_id", "")) for message in messages if message.get("agent_id")]
    agents = UserCanvasService.get_basic_info_by_canvas_ids(agent_ids) if agent_ids else []
    agent_names = {str(agent["id"]): agent["title"] for agent in agents}
    tasks = TaskService.get_tasks_progress_by_doc_ids([memory_id]) or []
    tasks.sort(key=lambda task: task["create_time"])
    task_by_source = {int(task["digest"]): task for task in tasks if str(task.get("digest", "")).isdigit()}
    for message in messages:
        message["extract"] = extracts.get(str(message["message_id"]), [])
        message["agent_name"] = agent_names.get(str(message.get("agent_id", "")), "Unknown")
        message["task"] = task_by_source.get(int(message["message_id"]), {})
        for extracted in message["extract"]:
            extracted["agent_name"] = agent_names.get(str(extracted.get("agent_id", "")), "Unknown")
    return SubjectMessagePage(
        data={
            "messages": {"message_list": messages, "total_count": total},
            "storage_type": memory.storage_type,
        },
        snapshot=effective_snapshot,
        after=effective_after,
        has_next=has_next,
    )


def recent_subject_messages(
    memory_ids: list[str],
    tenant_id: str,
    subject: str,
    agent_id: str,
    session_id: str,
    limit: int,
    request_id: str,
) -> list[dict[str, Any]]:
    for memory_id in memory_ids:
        _memory(memory_id, tenant_id, request_id)
    order_by = OrderByExpr().desc("valid_at")
    result, total = settings.msgStoreConn.search(
        select_fields=_CONTENT_FIELDS,
        highlight_fields=[],
        condition={"agent_id": agent_id, "session_id": session_id, "user_id": subject},
        match_expressions=[],
        order_by=order_by,
        offset=0,
        limit=limit,
        index_names=[index_name(tenant_id)],
        memory_ids=memory_ids,
        agg_fields=[],
    )
    if not total:
        return []
    return list((settings.msgStoreConn.get_fields(result, _CONTENT_FIELDS) or {}).values())


def get_subject_message(
    memory_id: str,
    message_id: int,
    tenant_id: str,
    subject: str,
    request_id: str,
) -> dict[str, Any]:
    _memory(memory_id, tenant_id, request_id)
    message = MessageService.get_by_message_id(memory_id, message_id, tenant_id)
    if not message or str(message.get("user_id", "")) != subject:
        raise resource_not_found(request_id)
    return message


def update_subject_message_status(
    memory_id: str,
    message_id: int,
    tenant_id: str,
    subject: str,
    status: bool,
    request_id: str,
) -> bool:
    get_subject_message(memory_id, message_id, tenant_id, subject, request_id)
    updated = MessageService.update_message(
        {"memory_id": memory_id, "message_id": message_id, "user_id": subject},
        {"status": status},
        tenant_id,
        memory_id,
    )
    if not updated:
        raise resource_not_found(request_id)
    return True


def forget_subject_message(
    memory_id: str,
    message_id: int,
    tenant_id: str,
    subject: str,
    request_id: str,
) -> bool:
    get_subject_message(memory_id, message_id, tenant_id, subject, request_id)
    updated = MessageService.update_message(
        {"memory_id": memory_id, "message_id": message_id, "user_id": subject},
        {"forget_at": timestamp_to_date(current_timestamp())},
        tenant_id,
        memory_id,
    )
    if not updated:
        raise resource_not_found(request_id)
    return True


def _memory(memory_id: str, tenant_id: str, request_id: str):
    memory = Memory.get_or_none(Memory.id == memory_id)
    if memory is None or memory.tenant_id != tenant_id:
        raise resource_not_found(request_id)
    return memory


def _message_key(message: dict[str, Any], request_id: str) -> tuple[int, str]:
    value = message.get("message_id")
    try:
        if isinstance(value, bool):
            raise TypeError
        message_id = int(value)
    except (TypeError, ValueError) as error:
        raise BusinessGatewayError(
            "RAGFLOW_SERVICE_UNAVAILABLE",
            "The RAGFlow memory store returned an invalid message identifier.",
            status=503,
            request_id=request_id,
            retryable=True,
        ) from error
    return message_id, str(value)
