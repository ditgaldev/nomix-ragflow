#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from types import ModuleType
from uuid import uuid4

import pytest
from peewee import CharField, DateTimeField, IntegerField, Model, SqliteDatabase, TextField
from playhouse.sqlite_ext import JSONField


@pytest.mark.p1
def test_idempotency_replay_conflict_reservation_isolation_and_cleanup(monkeypatch, gateway_modules):
    test_database = SqliteDatabase(":memory:")

    class Record(Model):
        id = CharField(primary_key=True)
        tenant_id = CharField()
        subject = CharField()
        operation = CharField()
        key_hash = CharField()
        request_hash = CharField()
        state = CharField(default="reserved")
        response_status = IntegerField(null=True)
        response_body = TextField(null=True)
        response_headers = JSONField(null=True, default={})
        expires_at = DateTimeField()

        class Meta:
            database = test_database
            indexes = ((("tenant_id", "subject", "operation", "key_hash"), True),)

    class Intent(Model):
        id = CharField(primary_key=True)
        operation = CharField()
        lookup_hash = CharField(index=True)
        authorization_hash = CharField(index=True)
        strategy = CharField(default="manual")
        descriptor = JSONField(default={})
        state = CharField(default="prepared")
        attempts = IntegerField(default=0)
        last_error = CharField(null=True)
        recover_after = DateTimeField()
        expires_at = DateTimeField()

        class Meta:
            database = test_database

    test_database.create_tables([Record, Intent])
    db_models = ModuleType("api.db.db_models")
    db_models.DB = test_database
    monkeypatch.setitem(sys.modules, "api.db.db_models", db_models)
    gateway_models = ModuleType(f"{gateway_modules.package_name}.models")
    gateway_models.BusinessGatewayIdempotencyRecord = Record
    gateway_models.BusinessGatewayExecutionIntent = Intent
    monkeypatch.setitem(sys.modules, f"{gateway_modules.package_name}.models", gateway_models)
    misc = ModuleType("common.misc_utils")
    misc.get_uuid = lambda: uuid4().hex
    monkeypatch.setitem(sys.modules, "common.misc_utils", misc)

    capabilities = gateway_modules("capabilities")
    types = gateway_modules("types")
    errors = gateway_modules("errors")
    module = gateway_modules("idempotency")
    capability = capabilities.capability_by_operation()["datasets.create"]

    def context(
        subject="subject-a",
        tenant="tenant-a",
        workspace="workspace-a",
        binding="binding-a",
        dataset_scope=None,
        permission_ref=None,
    ):
        authorization = types.BusinessAuthorizationContext(
            subject=subject,
            actor_subject=subject,
            on_behalf_of_subject=None,
            workspace_id=workspace,
            actions=capability.required_actions,
            dataset_scope=dataset_scope or types.ResourceScope("all"),
            document_scope=types.ResourceScope("inherit"),
            permission_ref=permission_ref,
            authentication_type="token-introspection",
            request_id=uuid4().hex,
            authority="https://identity.example.com",
            audience=("nomix-ragflow-data",),
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
            client_id="crm",
            token_use="data",
        )
        return types.RagFlowExecutionContext(
            authorization=authorization,
            tenant_id=tenant,
            execution_user_id="user-a",
            workspace_binding_id=binding,
            token_fingerprint="f" * 64,
            entry_point="rest",
        )

    fingerprint = module.request_fingerprint(capability, {}, {}, {"name": "dataset-a"})
    assert fingerprint == module.request_fingerprint(capability, {}, {}, {"name": "dataset-a"})
    with pytest.raises(errors.BusinessGatewayError) as required:
        module.reserve(capability, context(), None, fingerprint, "scope-a")
    assert (required.value.status, required.value.code) == (400, "IDEMPOTENCY_KEY_REQUIRED")

    first = module.reserve(capability, context(), "business-operation-1", fingerprint, "scope-a")
    record = Record.get_by_id(first.record_id)
    assert record.key_hash != "business-operation-1"
    now = datetime.now(UTC).replace(tzinfo=None)
    assert timedelta(minutes=1, seconds=59) < record.expires_at - now <= timedelta(minutes=2)

    with pytest.raises(errors.BusinessGatewayError) as reserved:
        module.reserve(capability, context(), "business-operation-1", fingerprint, "scope-a")
    assert (reserved.value.status, reserved.value.code, reserved.value.retryable) == (409, "IDEMPOTENCY_IN_PROGRESS", True)

    recovery = gateway_modules("recovery")
    executing = module.mark_executing(first, recovery.RecoveryPlan("manual", {"resourceId": "dataset-a"}))
    with pytest.raises(errors.BusinessGatewayError) as active_retry:
        module.reserve(capability, context(), "business-operation-1", fingerprint, "scope-a")
    assert (active_retry.value.status, active_retry.value.code, active_retry.value.retryable) == (409, "IDEMPOTENCY_IN_PROGRESS", True)
    assert module.execution_intent(executing) == recovery.RecoveryPlan("manual", {"resourceId": "dataset-a"})
    Intent.update(recover_after=datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)).where(Intent.id == executing.record_id).execute()
    assert module.reserve(capability, context(), "business-operation-1", fingerprint, "scope-a").recovery_required is True

    body = {"data": {"id": "dataset-a"}, "meta": {"requestId": "request-a"}}
    module.complete(executing, 201, body, {"Cache-Control": "no-store"})
    replay = module.reserve(capability, context(), "business-operation-1", fingerprint, "scope-a")
    assert replay.replay.status == 201
    assert replay.replay.body == body
    early_replay = module.lookup_existing_for_recovery(capability, context(), "business-operation-1", fingerprint)
    assert early_replay is not None and early_replay.replay.body == body
    assert (
        module.lookup_existing_for_recovery(
            capability,
            context(dataset_scope=types.ResourceScope("ids", frozenset({"dataset-a"}))),
            "business-operation-1",
            fingerprint,
        )
        is None
    )
    with pytest.raises(errors.BusinessGatewayError) as lost_transition:
        module.complete(executing, 201, body)
    assert (lost_transition.value.status, lost_transition.value.code) == (503, "IDEMPOTENCY_OUTCOME_UNKNOWN")

    conflict_fingerprint = module.request_fingerprint(capability, {}, {}, {"name": "dataset-b"})
    with pytest.raises(errors.BusinessGatewayError) as conflict:
        module.reserve(capability, context(), "business-operation-1", conflict_fingerprint, "scope-a")
    assert (conflict.value.status, conflict.value.code) == (409, "IDEMPOTENCY_CONFLICT")

    isolated_subject = module.reserve(capability, context(subject="subject-b"), "business-operation-1", fingerprint, "scope-a")
    isolated_tenant = module.reserve(capability, context(tenant="tenant-b"), "business-operation-1", fingerprint, "scope-a")
    isolated_workspace = module.reserve(
        capability,
        context(workspace="workspace-b", binding="binding-b"),
        "business-operation-1",
        fingerprint,
        "scope-a",
    )
    isolated_scope = module.reserve(
        capability,
        context(dataset_scope=types.ResourceScope("ids", frozenset({"dataset-a"}))),
        "business-operation-1",
        fingerprint,
        "scope-b",
    )
    assert isolated_subject.record_id != first.record_id
    assert isolated_tenant.record_id != first.record_id
    assert isolated_workspace.record_id != first.record_id
    assert isolated_scope.record_id != first.record_id

    uncertain = module.reserve(capability, context(subject="subject-c"), "business-operation-1", fingerprint, "scope-a")
    uncertain = module.mark_executing(uncertain, recovery.RecoveryPlan())
    module.mark_uncertain(uncertain)
    assert Intent.get_by_id(uncertain.record_id).state == "uncertain"

    recoverable = module.reserve(capability, context(subject="subject-d"), "business-operation-1", fingerprint, "scope-a")
    recoverable = module.mark_executing(recoverable, recovery.RecoveryPlan("resource-create", {"id": "dataset-d"}))
    module.mark_uncertain(recoverable)
    retry = module.reserve(capability, context(subject="subject-d"), "business-operation-1", fingerprint, "scope-a")
    recovered_body = {"data": {"id": "dataset-d"}, "meta": {"requestId": "request-d"}}
    module.complete_recovered(retry, 201, recovered_body, {"Cache-Control": "no-store"})
    assert Intent.get_by_id(recoverable.record_id).state == "recovered"
    assert module.reserve(capability, context(subject="subject-d"), "business-operation-1", fingerprint, "scope-a").replay.body == recovered_body

    Record.update(expires_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)).execute()
    assert module.cleanup_expired() == 6
    assert Record.select().count() == 1
    assert Record.get().state == "uncertain"
    test_database.close()
