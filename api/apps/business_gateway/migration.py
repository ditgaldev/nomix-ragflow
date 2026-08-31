#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Versioned, checksummed, forward-only migrations for the Gateway plane."""

from __future__ import annotations

import hashlib
import importlib
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

from api.db.db_models import DB

from .models import (
    BusinessGatewayAuditEvent,
    BusinessGatewayExecutionIntent,
    BusinessGatewayIdempotencyRecord,
    BusinessGatewaySchemaMigration,
    BusinessGatewayWorkspaceBinding,
)

_MIGRATION_MODULES = (
    "v0001_initial",
    "v0002_remove_local_grant_authority",
    "v0003_append_only_audit",
    "v0004_execution_intent",
)
_PROCESS_LOCK = threading.Lock()


@dataclass(frozen=True)
class MigrationDefinition:
    name: str
    checksum: str
    module: ModuleType


@dataclass(frozen=True)
class MigrationStatus:
    ready: bool
    applied: tuple[str, ...]
    pending: tuple[str, ...]
    error: str | None = None


def migrate_business_gateway_schema() -> tuple[str, ...]:
    """Apply every pending migration exactly once under a cross-replica lock."""

    migrations = _definitions()
    with DB.connection_context():
        DB.create_tables([BusinessGatewaySchemaMigration], safe=True)
        with _migration_lock():
            applied = _applied()
            _verify_checksums(migrations, applied)
            for migration in migrations:
                if migration.name in applied:
                    continue
                migration.module.apply(DB, _owned_models())
                BusinessGatewaySchemaMigration.create(name=migration.name, checksum=migration.checksum)
                applied[migration.name] = migration.checksum
    return (
        BusinessGatewaySchemaMigration._meta.table_name,
        *(model._meta.table_name for model in _owned_models()),
    )


def business_gateway_schema_status() -> MigrationStatus:
    """Return a secret-free readiness view without mutating the schema."""

    try:
        migrations = _definitions()
        with DB.connection_context():
            if not BusinessGatewaySchemaMigration.table_exists():
                return MigrationStatus(False, (), tuple(item.name for item in migrations), "migration-ledger-missing")
            applied = _applied()
            _verify_checksums(migrations, applied)
            expected = {item.name for item in migrations}
            pending = tuple(item.name for item in migrations if item.name not in applied)
            unknown = sorted(set(applied) - expected)
            missing_tables = [model._meta.table_name for model in _owned_models() if not model.table_exists()]
            if unknown:
                return MigrationStatus(False, tuple(sorted(applied)), pending, "unknown-migration")
            if missing_tables:
                return MigrationStatus(False, tuple(sorted(applied)), pending, "gateway-table-missing")
            return MigrationStatus(not pending, tuple(sorted(applied)), pending)
    except Exception as error:  # noqa: BLE001 - readiness must not expose database messages
        return MigrationStatus(False, (), (), type(error).__name__)


def _definitions() -> tuple[MigrationDefinition, ...]:
    result = []
    for module_name in _MIGRATION_MODULES:
        module = importlib.import_module(f"{__package__}.migrations.{module_name}")
        path = Path(module.__file__ or "")
        if not path.is_file() or not callable(getattr(module, "apply", None)):
            raise RuntimeError(f"Invalid Business Gateway migration: {module_name}")
        source = path.read_bytes().replace(b"\r\n", b"\n")
        result.append(MigrationDefinition(module_name.removeprefix("v"), hashlib.sha256(source).hexdigest(), module))
    return tuple(result)


def _applied() -> dict[str, str]:
    return {str(row.name): str(row.checksum) for row in BusinessGatewaySchemaMigration.select()}


def _verify_checksums(migrations: tuple[MigrationDefinition, ...], applied: dict[str, str]) -> None:
    for migration in migrations:
        checksum = applied.get(migration.name)
        if checksum is not None and checksum != migration.checksum:
            raise RuntimeError(f"Applied Business Gateway migration was modified: {migration.name}")


def _owned_models() -> tuple[type, ...]:
    return (
        BusinessGatewayWorkspaceBinding,
        BusinessGatewayIdempotencyRecord,
        BusinessGatewayExecutionIntent,
        BusinessGatewayAuditEvent,
    )


@contextmanager
def _migration_lock() -> Iterator[None]:
    lock_factory = getattr(DB, "lock", None)
    if callable(lock_factory):
        with lock_factory("business_gateway_schema_migration", 60):
            yield
        return
    with _PROCESS_LOCK:
        yield


__all__ = [
    "MigrationStatus",
    "business_gateway_schema_status",
    "migrate_business_gateway_schema",
]
