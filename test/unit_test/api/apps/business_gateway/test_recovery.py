from __future__ import annotations

from types import SimpleNamespace

import pytest


@pytest.mark.p1
def test_recovery_targets_select_the_mutated_resource_not_its_parent(gateway_modules):
    recovery = gateway_modules("recovery")

    def prepared(path_args, payload=None):
        return SimpleNamespace(path_args=path_args, payload=payload)

    assert recovery.command_target_ids(
        "chunks.delete",
        prepared({"dataset_id": "dataset-a", "document_id": "document-a", "chunk_id": "chunk-a"}),
    ) == ["chunk-a"]
    assert recovery.command_target_ids(
        "documents.delete",
        prepared({"dataset_id": "dataset-a", "document_id": "document-a"}),
    ) == ["document-a"]
    assert recovery.command_target_ids("datasets.delete", prepared({"dataset_id": "dataset-a"})) == ["dataset-a"]
    assert recovery.command_target_ids(
        "agentSessions.delete",
        prepared({"agent_id": "agent-a", "session_id": "session-a"}),
    ) == ["session-a"]
    assert recovery.command_target_ids(
        "documents.startParse",
        prepared({"dataset_id": "dataset-a"}, {"documentIds": ["document-a", "document-b"]}),
    ) == ["document-a", "document-b"]
    assert recovery.command_target_ids(
        "pageIndex.build",
        prepared({"dataset_id": "dataset-a"}, {"documentIds": ["document-a", "document-b"]}),
    ) == ["document-a", "document-b"]
    assert recovery.command_target_ids(
        "chats.batchDelete",
        prepared({}, {"ids": ["chat-a", "chat-b"]}),
    ) == ["chat-a", "chat-b"]


@pytest.mark.p1
def test_page_index_recovery_requires_native_task_evidence(gateway_modules):
    recovery = gateway_modules("recovery")

    assert recovery.page_index_recovery_action("0", set(), "1", {"task-new"}) == "applied"
    assert recovery.page_index_recovery_action("0", set(), "1", set()) == "resume"
    assert recovery.page_index_recovery_action("0", set(), "0", set()) == "resume"
    assert recovery.page_index_recovery_action("0", {"task-old"}, "1", {"task-old"}) == "unknown"
