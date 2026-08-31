#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from quart import Quart


async def readiness_status(app: Quart) -> tuple[bool, dict[str, str]]:
    """Check every dependency required by the complete Gateway capability set."""

    timeout = app.extensions["business_gateway_settings"].readiness_timeout_seconds
    introspector = app.extensions["business_gateway_introspector"]
    cursor = app.extensions["business_gateway_cursor_codec"]

    from api.utils.health_utils import check_db, check_doc_engine, check_redis, check_storage

    checks = await asyncio.gather(
        _sync_check("database", check_db, timeout),
        _sync_check("redis", check_redis, timeout),
        _sync_check("documentStore", check_doc_engine, timeout),
        _sync_check("objectStorage", check_storage, timeout),
        _sync_check("migrations", _migration_check, timeout),
        _async_check("introspection", introspector.probe, timeout),
    )
    result = dict(checks)
    result["cursorSigning"] = "ok" if cursor.configured() else "failed"
    ready = all(value == "ok" for value in result.values())
    telemetry = app.extensions.get("business_gateway_telemetry")
    if telemetry is not None:
        telemetry.set_readiness(ready)
        for component, value in result.items():
            if value != "ok":
                telemetry.observe_failure("readiness", component)
    return ready, result


def _migration_check() -> tuple[bool, dict[str, Any]]:
    from .migration import business_gateway_schema_status

    return business_gateway_schema_status().ready, {}


async def _sync_check(
    name: str,
    check: Callable[[], tuple[bool, dict[str, Any]]],
    timeout_seconds: float,
) -> tuple[str, str]:
    try:
        ok, _details = await asyncio.wait_for(asyncio.to_thread(check), timeout_seconds)
        return name, "ok" if ok else "failed"
    except Exception:  # noqa: BLE001 - readiness responses and metrics must not expose dependency messages
        return name, "failed"


async def _async_check(
    name: str,
    check: Callable[[], Awaitable[bool]],
    timeout_seconds: float,
) -> tuple[str, str]:
    try:
        return name, "ok" if await asyncio.wait_for(check(), timeout_seconds) else "failed"
    except Exception:  # noqa: BLE001 - readiness responses must fail closed without dependency details
        return name, "failed"


__all__ = ["readiness_status"]
