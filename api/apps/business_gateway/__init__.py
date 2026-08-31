#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import asyncio
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from quart import Quart


INTERNAL_PREFIX = "/api/business/v1"


def register_business_gateway(app: Quart) -> None:
    from .config import BusinessGatewaySettings

    settings = BusinessGatewaySettings.from_env()
    app.extensions["business_gateway_settings"] = settings
    if not settings.enabled:
        app.extensions["business_gateway_enabled"] = False
        return

    from .adapter import RagFlowBusinessServiceAdapter
    from .cli import register_business_gateway_commands
    from .concurrency import OptimisticConcurrencyManager
    from .cursor import CursorCodec
    from .introspection import TokenIntrospector
    from .migration import business_gateway_schema_status
    from .routes import business_gateway
    from .telemetry import BusinessGatewayTelemetry

    telemetry = BusinessGatewayTelemetry()
    introspector = TokenIntrospector(telemetry=telemetry)
    cursor = CursorCodec(os.getenv("NOMIX_BG_CURSOR_SECRET"))

    app.extensions["business_gateway_enabled"] = True
    app.extensions["business_gateway_telemetry"] = telemetry
    app.extensions["business_gateway_introspector"] = introspector
    app.extensions["business_gateway_adapter"] = RagFlowBusinessServiceAdapter()
    app.extensions["business_gateway_cursor_codec"] = cursor
    app.extensions["business_gateway_concurrency"] = OptimisticConcurrencyManager()
    app.register_blueprint(business_gateway, url_prefix=INTERNAL_PREFIX)
    register_business_gateway_commands(app)

    @app.before_serving
    async def _start_business_gateway_dependencies() -> None:
        if not cursor.configured():
            raise RuntimeError("NOMIX_BG_CURSOR_SECRET must contain at least 32 bytes when Business Gateway is enabled")
        schema = await asyncio.to_thread(business_gateway_schema_status)
        if not schema.ready:
            raise RuntimeError("Business Gateway schema migrations must be applied before serving traffic")
        await introspector.start()

    @app.after_serving
    async def _close_business_gateway_dependencies() -> None:
        await introspector.close()


__all__ = ["INTERNAL_PREFIX", "register_business_gateway"]
