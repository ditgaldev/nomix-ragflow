#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from types import ModuleType

import pytest
from peewee import CharField, DateTimeField, IntegerField, Model, SqliteDatabase, TextField
from playhouse.sqlite_ext import JSONField


@pytest.mark.p1
def test_uncertain_idempotency_reconciliation_is_dry_runnable_guarded_and_atomic(monkeypatch, gateway_modules):
    test_database = SqliteDatabase(":memory:")

    class Record(Model):
        id = CharField(primary_key=True)
        tenant_id = CharField()
        subject = CharField()
        operation = CharField()
        key_hash = CharField()
        request_hash = CharField()
        state = CharField()
        response_status = IntegerField(null=True)
        response_body = TextField(null=True)
        response_headers = JSONField(null=True, default={})
        expires_at = DateTimeField()
        update_time = IntegerField(default=1)

        class Meta:
            database = test_database

    class Intent(Model):
        id = CharField(primary_key=True)
        strategy = CharField(default="manual")
        attempts = IntegerField(default=0)
        last_error = CharField(null=True)
        state = CharField(default="uncertain")
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

    module = gateway_modules("reconciliation")
    now = datetime.now(UTC).replace(tzinfo=None)

    def create(record_id: str, operation: str = "datasets.create") -> None:
        Record.create(
            id=record_id,
            tenant_id="tenant-a",
            subject="subject-a",
            operation=operation,
            key_hash="k" * 64,
            request_hash="a" * 64,
            state="uncertain",
            expires_at=now + timedelta(hours=1),
            update_time=1,
        )
        Intent.create(id=record_id, recover_after=now, expires_at=now + timedelta(hours=1))

    create("record-applied")
    records = module.action_required_records()
    assert records == [
        {
            "recordId": "record-applied",
            "tenantId": "tenant-a",
            "subject": "subject-a",
            "operation": "datasets.create",
            "state": "uncertain",
            "requestHash": "a" * 64,
            "updatedAt": 1,
            "expiresAt": (now + timedelta(hours=1)).replace(tzinfo=UTC).isoformat(),
            "recoveryStrategy": "manual",
            "recoveryAttempts": 0,
            "lastRecoveryError": None,
            "recoveryTargets": {},
        }
    ]

    envelope = {"data": {"id": "dataset-a"}, "meta": {"requestId": "request-a"}}
    preview = module.reconcile_idempotency(
        "record-applied",
        expected_operation="datasets.create",
        expected_request_hash="a" * 64,
        outcome="applied",
        response_status=201,
        response_body=envelope,
        dry_run=True,
        now=now,
    )
    assert preview.to_dict() == {
        "recordId": "record-applied",
        "operation": "datasets.create",
        "requestHash": "a" * 64,
        "previousState": "uncertain",
        "outcome": "applied",
        "responseStatus": 201,
        "dryRun": True,
    }
    assert Record.get_by_id("record-applied").state == "uncertain"

    with pytest.raises(module.IdempotencyReconciliationError, match="expected-operation"):
        module.reconcile_idempotency(
            "record-applied",
            expected_operation="documents.upload",
            expected_request_hash="a" * 64,
            outcome="applied",
            response_status=201,
            response_body=envelope,
        )
    with pytest.raises(module.IdempotencyReconciliationError, match="meta.requestId"):
        module.reconcile_idempotency(
            "record-applied",
            expected_operation="datasets.create",
            expected_request_hash="a" * 64,
            outcome="applied",
            response_status=201,
            response_body={"data": {}, "meta": {}},
        )
    with pytest.raises(module.IdempotencyReconciliationError, match="expected-request-hash"):
        module.reconcile_idempotency(
            "record-applied",
            expected_operation="datasets.create",
            expected_request_hash="b" * 64,
            outcome="applied",
            response_status=201,
            response_body=envelope,
        )

    applied = module.reconcile_idempotency(
        "record-applied",
        expected_operation="datasets.create",
        expected_request_hash="a" * 64,
        outcome="applied",
        response_status=201,
        response_body=envelope,
        now=now,
    )
    assert applied.dry_run is False
    stored = Record.get_by_id("record-applied")
    assert stored.state == "completed"
    assert stored.response_status == 201
    assert json.loads(stored.response_body) == envelope
    assert stored.response_headers == {"Cache-Control": "no-store"}
    assert Intent.get_by_id("record-applied").state == "operator-reconciled"

    create("record-released", "documents.upload")
    released = module.reconcile_idempotency(
        "record-released",
        expected_operation="documents.upload",
        expected_request_hash="a" * 64,
        outcome="not-applied",
    )
    assert released.outcome == "not-applied"
    assert Record.get_or_none(Record.id == "record-released") is None
    assert Intent.get_or_none(Intent.id == "record-released") is None

    with pytest.raises(module.IdempotencyReconciliationError, match="not found"):
        module.reconcile_idempotency(
            "record-applied",
            expected_operation="datasets.create",
            expected_request_hash="a" * 64,
            outcome="not-applied",
        )
    test_database.close()
