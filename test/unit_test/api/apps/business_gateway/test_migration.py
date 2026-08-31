from __future__ import annotations

import sys
from contextlib import contextmanager
from types import ModuleType

import pytest
from peewee import CharField, Model, SqliteDatabase


@pytest.mark.p1
def test_gateway_migrations_are_versioned_locked_idempotent_and_checksummed(monkeypatch, gateway_modules, tmp_path):
    test_database = SqliteDatabase(tmp_path / "gateway-migrations.db")
    lock_entries = []

    @contextmanager
    def lock(name, timeout):
        lock_entries.append((name, timeout))
        yield

    test_database.lock = lock

    class Base(Model):
        class Meta:
            database = test_database

    class Workspace(Base):
        id = CharField(primary_key=True)

        class Meta:
            table_name = "business_gateway_workspace_binding"

    class Idempotency(Base):
        id = CharField(primary_key=True)

        class Meta:
            table_name = "business_gateway_idempotency"

    class Audit(Base):
        id = CharField(primary_key=True)

        class Meta:
            table_name = "business_gateway_audit_event"

    class Intent(Base):
        id = CharField(primary_key=True)

        class Meta:
            table_name = "business_gateway_execution_intent"

    class Ledger(Base):
        name = CharField(primary_key=True)
        checksum = CharField()

        class Meta:
            table_name = "business_gateway_schema_migration"

    db_models = ModuleType("api.db.db_models")
    db_models.DB = test_database
    monkeypatch.setitem(sys.modules, "api.db.db_models", db_models)
    models = ModuleType(f"{gateway_modules.package_name}.models")
    models.BusinessGatewayWorkspaceBinding = Workspace
    models.BusinessGatewayIdempotencyRecord = Idempotency
    models.BusinessGatewayExecutionIntent = Intent
    models.BusinessGatewayAuditEvent = Audit
    models.BusinessGatewaySchemaMigration = Ledger
    monkeypatch.setitem(sys.modules, f"{gateway_modules.package_name}.models", models)

    migration = gateway_modules("migration")
    first = migration.migrate_business_gateway_schema()
    second = migration.migrate_business_gateway_schema()

    assert (
        first
        == second
        == (
            "business_gateway_schema_migration",
            "business_gateway_workspace_binding",
            "business_gateway_idempotency",
            "business_gateway_execution_intent",
            "business_gateway_audit_event",
        )
    )
    assert [row.name for row in Ledger.select().order_by(Ledger.name)] == [
        "0001_initial",
        "0002_remove_local_grant_authority",
        "0003_append_only_audit",
        "0004_execution_intent",
    ]
    assert lock_entries == [("business_gateway_schema_migration", 60)] * 2
    assert migration.business_gateway_schema_status().ready

    Ledger.update(checksum="tampered").where(Ledger.name == "0001_initial").execute()
    status = migration.business_gateway_schema_status()
    assert not status.ready and status.error == "RuntimeError"
    with pytest.raises(RuntimeError, match="was modified"):
        migration.migrate_business_gateway_schema()
