#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import asyncio
import sys
from types import ModuleType, SimpleNamespace

import pytest


def _install_model_stubs(monkeypatch):
    module = ModuleType("api.db.db_models")
    for name in ("API4Conversation", "Conversation", "Dialog", "Document", "Knowledgebase", "Memory", "UserCanvas"):
        setattr(module, name, type(name, (), {}))
    monkeypatch.setitem(sys.modules, "api.db.db_models", module)
    quart = ModuleType("quart")
    quart.jsonify = lambda value: value
    monkeypatch.setitem(sys.modules, "quart", quart)


@pytest.mark.p1
def test_if_match_is_required_closed_and_numeric(monkeypatch, gateway_modules):
    _install_model_stubs(monkeypatch)
    concurrency = gateway_modules("concurrency")
    errors = gateway_modules("errors")

    assert concurrency.parse_if_match("42") == 42
    assert concurrency.parse_if_match('W/"42"') == 42
    for value in (None, "", "*", "0", "1,2", "tenant=1"):
        with pytest.raises(errors.BusinessGatewayError) as invalid:
            concurrency.parse_if_match(value, "request-version")
        assert (invalid.value.status, invalid.value.code) == (428, "VERSION_REQUIRED")


@pytest.mark.p1
def test_version_check_runs_inside_a_distributed_gateway_lock(monkeypatch, gateway_modules):
    _install_model_stubs(monkeypatch)
    concurrency = gateway_modules("concurrency")
    errors = gateway_modules("errors")
    locks = []

    class Lock:
        def __init__(self, key, timeout, blocking_timeout):
            self.key = key
            self.timeout = timeout
            self.blocking_timeout = blocking_timeout
            self.released = False
            locks.append(self)

        def acquire(self):
            return True

        def release(self):
            self.released = True

    redis = ModuleType("rag.utils.redis_conn")
    redis.RedisDistributedLock = Lock
    monkeypatch.setitem(sys.modules, "rag.utils.redis_conn", redis)
    monkeypatch.setattr(
        concurrency,
        "version_target",
        lambda *_args, **_kwargs: concurrency.VersionTarget("dataset", "dataset-a", 7),
    )
    manager = concurrency.OptimisticConcurrencyManager()
    capability = SimpleNamespace(operation="datasets.update")
    context = SimpleNamespace(tenant_id="tenant-a", request_id="request-a")

    lease = asyncio.run(manager.acquire(capability, context, SimpleNamespace(), "7"))
    assert lease is not None
    assert locks[0].key.startswith("nomix:bg:version:")
    assert "dataset-a" not in locks[0].key
    asyncio.run(lease.release())
    assert locks[0].released is True

    with pytest.raises(errors.BusinessGatewayError) as stale:
        asyncio.run(manager.acquire(capability, context, SimpleNamespace(), "6"))
    assert (stale.value.status, stale.value.code) == (409, "VERSION_CONFLICT")
    assert locks[-1].released is True

    class Field:
        def __eq__(self, _other):
            return object()

    class Parent:
        id = Field()

        @classmethod
        def get_or_none(cls, _condition):
            return SimpleNamespace(id="document-a")

    monkeypatch.setitem(concurrency._LOCK_ONLY_TARGETS, "chunks.create", (Parent, "document_id", "document"))
    assert concurrency.requires_mutation_lock("chunks.create")
    mutation_lease = asyncio.run(
        manager.acquire_mutation(
            SimpleNamespace(operation="chunks.create"),
            context,
            SimpleNamespace(path_args={"document_id": "document-a"}),
        )
    )
    assert mutation_lease is not None
    asyncio.run(mutation_lease.release())
    assert locks[-1].released is True

    monkeypatch.setattr(concurrency.Knowledgebase, "id", Field(), raising=False)
    monkeypatch.setattr(
        concurrency.Knowledgebase,
        "get_or_none",
        classmethod(lambda _cls, _condition: SimpleNamespace(id="dataset-a")),
        raising=False,
    )
    page_index_lease = asyncio.run(
        manager.acquire_mutation(
            SimpleNamespace(operation="pageIndex.build"),
            context,
            SimpleNamespace(path_args={"dataset_id": "dataset-a"}, document_ids=frozenset({"document-b", "document-a"})),
        )
    )
    assert page_index_lease is not None
    assert [lock.key for lock in locks[-3:]] == [
        concurrency._lock_key("tenant-a", "page-index-tenant", "tenant-a"),
        concurrency._lock_key("tenant-a", "document", "document-a"),
        concurrency._lock_key("tenant-a", "document", "document-b"),
    ]
    asyncio.run(page_index_lease.release())
    assert all(lock.released for lock in locks[-3:])

    parse_lease = asyncio.run(
        manager.acquire_mutation(
            SimpleNamespace(operation="documents.startParse"),
            context,
            SimpleNamespace(path_args={"dataset_id": "dataset-a"}, document_ids=frozenset({"document-b", "document-a"})),
        )
    )
    assert parse_lease is not None
    assert [lock.key for lock in locks[-2:]] == [
        concurrency._lock_key("tenant-a", "document", "document-a"),
        concurrency._lock_key("tenant-a", "document", "document-b"),
    ]
    asyncio.run(parse_lease.release())
    assert all(lock.released for lock in locks[-2:])

    page_index_recovery_lease = asyncio.run(
        manager.acquire_recovery(
            SimpleNamespace(operation="pageIndex.build"),
            context,
            SimpleNamespace(path_args={"dataset_id": "dataset-a"}, document_ids=frozenset({"document-a"})),
        )
    )
    assert page_index_recovery_lease is not None
    assert [lock.key for lock in locks[-2:]] == [
        concurrency._lock_key("tenant-a", "page-index-tenant", "tenant-a"),
        concurrency._lock_key("tenant-a", "document", "document-a"),
    ]
    asyncio.run(page_index_recovery_lease.release())
    assert all(lock.released for lock in locks[-2:])

    recovery_lease = asyncio.run(
        manager.acquire_recovery(
            SimpleNamespace(operation="datasets.delete"),
            context,
            SimpleNamespace(path_args={"dataset_id": "dataset-a"}),
        )
    )
    assert recovery_lease is not None
    assert locks[-1].key.startswith("nomix:bg:version:")
    asyncio.run(recovery_lease.release())
    assert locks[-1].released is True
