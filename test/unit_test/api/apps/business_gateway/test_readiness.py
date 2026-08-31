from __future__ import annotations

import asyncio
import sys
from types import ModuleType, SimpleNamespace

import pytest


@pytest.mark.p1
def test_readiness_checks_all_gateway_dependencies_and_reports_no_secret_details(monkeypatch, gateway_modules):
    readiness = gateway_modules("readiness")
    telemetry_module = gateway_modules("telemetry")

    health = ModuleType("api.utils.health_utils")
    health.check_db = lambda: (True, {"password": "must-not-leak"})
    health.check_redis = lambda: (True, {})
    health.check_doc_engine = lambda: (True, {})
    health.check_storage = lambda: (True, {})
    monkeypatch.setitem(sys.modules, "api.utils.health_utils", health)

    migration = ModuleType(f"{gateway_modules.package_name}.migration")
    migration.business_gateway_schema_status = lambda: SimpleNamespace(ready=True)
    monkeypatch.setitem(sys.modules, f"{gateway_modules.package_name}.migration", migration)

    class Introspector:
        async def probe(self):
            return True

    app = SimpleNamespace(
        extensions={
            "business_gateway_settings": SimpleNamespace(readiness_timeout_seconds=1),
            "business_gateway_introspector": Introspector(),
            "business_gateway_cursor_codec": SimpleNamespace(configured=lambda: True),
            "business_gateway_telemetry": telemetry_module.BusinessGatewayTelemetry(),
        }
    )
    ready, checks = asyncio.run(readiness.readiness_status(app))

    assert ready
    assert checks == {
        "database": "ok",
        "redis": "ok",
        "documentStore": "ok",
        "objectStorage": "ok",
        "migrations": "ok",
        "introspection": "ok",
        "cursorSigning": "ok",
    }
    assert "password" not in str(checks)
    metrics = app.extensions["business_gateway_telemetry"].render_prometheus(2)
    assert "nomix_ragflow_business_gateway_ready 1" in metrics
    assert "nomix_ragflow_business_gateway_uncertain_idempotency_records 2" in metrics
    assert "nomix_ragflow_business_gateway_stale_executing_idempotency_records 0" in metrics
