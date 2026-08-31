#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace

import pytest


@pytest.mark.p1
def test_gateway_memory_message_scope_is_subject_bound_without_native_service_changes(monkeypatch, gateway_modules):
    conditions = []
    updates = []

    class Field:
        def __eq__(self, value):
            return value

    class Memory:
        id = Field()

        @staticmethod
        def get_or_none(_expression):
            return SimpleNamespace(id="memory-a", tenant_id="tenant-a", storage_type="doc-store")

    db_models = ModuleType("api.db.db_models")
    db_models.Memory = Memory
    monkeypatch.setitem(sys.modules, "api.db.db_models", db_models)

    canvas_service = ModuleType("api.db.services.canvas_service")
    canvas_service.UserCanvasService = type(
        "UserCanvasService",
        (),
        {"get_basic_info_by_canvas_ids": staticmethod(lambda _ids: [])},
    )
    monkeypatch.setitem(sys.modules, "api.db.services.canvas_service", canvas_service)
    task_service = ModuleType("api.db.services.task_service")
    task_service.TaskService = type(
        "TaskService",
        (),
        {"get_tasks_progress_by_doc_ids": staticmethod(lambda _ids: [])},
    )
    monkeypatch.setitem(sys.modules, "api.db.services.task_service", task_service)

    class Store:
        @classmethod
        def search(cls, **kwargs):
            conditions.append(kwargs["condition"])
            if "message_type" in kwargs["condition"]:
                return {
                    "raw": {
                        "message_id": 7,
                        "message_type": "raw",
                        "source_id": 0,
                        "memory_id": "memory-a",
                        "user_id": "subject-a",
                        "agent_id": "agent-a",
                        "session_id": "session-a",
                        "valid_at": 100,
                        "status": 1,
                    },
                    "older": {
                        "message_id": 6,
                        "message_type": "raw",
                        "source_id": 0,
                        "memory_id": "memory-a",
                        "user_id": "subject-a",
                        "agent_id": "agent-a",
                        "session_id": "session-a",
                        "valid_at": 99,
                        "status": 1,
                    },
                }, 2
            if "source_id" in kwargs["condition"]:
                return {
                    "extract": {
                        "message_id": 8,
                        "message_type": "extract",
                        "source_id": 7,
                        "memory_id": "memory-a",
                        "user_id": "subject-a",
                        "agent_id": "agent-a",
                        "session_id": "session-a",
                        "valid_at": 99,
                        "status": 1,
                    }
                }, 1
            return {
                "recent": {
                    "message_id": 9,
                    "memory_id": "memory-a",
                    "user_id": "subject-a",
                    "agent_id": "agent-a",
                    "session_id": "session-a",
                    "valid_at": 98,
                    "status": 1,
                    "content": "hello",
                }
            }, 1

        @staticmethod
        def get_fields(result, _fields):
            return result

    common = ModuleType("common")
    common.settings = SimpleNamespace(msgStoreConn=Store())
    monkeypatch.setitem(sys.modules, "common", common)
    constants = ModuleType("common.constants")
    constants.MemoryType = SimpleNamespace(RAW=SimpleNamespace(name="RAW"))
    monkeypatch.setitem(sys.modules, "common.constants", constants)
    doc_store = ModuleType("common.doc_store.doc_store_base")

    class OrderByExpr:
        def desc(self, _field):
            return self

    doc_store.OrderByExpr = OrderByExpr
    monkeypatch.setitem(sys.modules, "common.doc_store", ModuleType("common.doc_store"))
    monkeypatch.setitem(sys.modules, "common.doc_store.doc_store_base", doc_store)
    time_utils = ModuleType("common.time_utils")
    time_utils.current_timestamp = lambda: 1
    time_utils.timestamp_to_date = lambda value: value
    monkeypatch.setitem(sys.modules, "common.time_utils", time_utils)

    message_service = ModuleType("memory.services.messages")

    class MessageService:
        @staticmethod
        def get_by_message_id(_memory_id, _message_id, _tenant_id):
            return {"message_id": 7, "user_id": "subject-a", "content": "hello"}

        @staticmethod
        def update_message(condition, values, _tenant_id, _memory_id):
            updates.append((condition, values))
            return True

    message_service.MessageService = MessageService
    message_service.index_name = lambda tenant_id: f"memory_{tenant_id}"
    monkeypatch.setitem(sys.modules, "memory.services.messages", message_service)

    errors = gateway_modules("errors")
    scope = gateway_modules("memory_scope")
    listed = scope.list_subject_messages("memory-a", "tenant-a", "subject-a", 1, "request-a")
    next_page = scope.list_subject_messages(
        "memory-a",
        "tenant-a",
        "subject-a",
        1,
        "request-a",
        snapshot=listed.snapshot,
        after=listed.after,
    )
    recent = scope.recent_subject_messages(
        ["memory-a"],
        "tenant-a",
        "subject-a",
        "agent-a",
        "session-a",
        10,
        "request-a",
    )
    assert listed.data["messages"]["message_list"][0]["user_id"] == "subject-a"
    assert listed.snapshot == (7, "7")
    assert listed.after == (7, "7")
    assert listed.has_next is True
    assert next_page.data["messages"]["message_list"][0]["message_id"] == 6
    assert next_page.snapshot == listed.snapshot
    assert next_page.has_next is False
    assert recent[0]["user_id"] == "subject-a"
    assert all(condition["user_id"] == "subject-a" for condition in conditions)

    assert scope.update_subject_message_status("memory-a", 7, "tenant-a", "subject-a", True, "request-a") is True
    assert updates == [
        (
            {"memory_id": "memory-a", "message_id": 7, "user_id": "subject-a"},
            {"status": True},
        )
    ]

    MessageService.get_by_message_id = staticmethod(lambda _memory_id, _message_id, _tenant_id: {"message_id": 7, "user_id": "subject-b"})
    with pytest.raises(errors.BusinessGatewayError) as hidden:
        scope.get_subject_message("memory-a", 7, "tenant-a", "subject-a", "request-a")
    assert (hidden.value.status, hidden.value.code) == (404, "RESOURCE_NOT_FOUND")
