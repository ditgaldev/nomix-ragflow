from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest


@pytest.mark.p1
def test_gateway_is_opt_in_and_request_limits_are_bounded(monkeypatch, gateway_modules):
    config = gateway_modules("config")
    for name in (
        "NOMIX_BG_ENABLED",
        "NOMIX_BG_MAX_FILE_BYTES",
        "NOMIX_BG_MAX_REQUEST_BYTES",
        "NOMIX_BG_READINESS_TIMEOUT_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)

    settings = config.BusinessGatewaySettings.from_env()
    assert settings.enabled is False
    assert settings.max_file_bytes == 64 * 1024 * 1024
    assert settings.max_request_bytes == config.DEFAULT_MAX_REQUEST_BYTES
    assert settings.max_request_bytes - settings.max_file_bytes == 8 * 1024 * 1024

    monkeypatch.setenv("NOMIX_BG_ENABLED", "true")
    monkeypatch.setenv("NOMIX_BG_MAX_FILE_BYTES", "1024")
    monkeypatch.setenv("NOMIX_BG_MAX_REQUEST_BYTES", str(1024 + config.MIN_MULTIPART_OVERHEAD_BYTES))
    assert config.BusinessGatewaySettings.from_env().enabled is True
    assert config.BusinessGatewaySettings.from_env().max_file_bytes == 1024

    monkeypatch.setenv("NOMIX_BG_MAX_REQUEST_BYTES", str(config.MAX_REQUEST_BYTES + 1))
    with pytest.raises(RuntimeError, match="must be between"):
        config.BusinessGatewaySettings.from_env()

    monkeypatch.setenv("NOMIX_BG_MAX_REQUEST_BYTES", str(1024 + config.MIN_MULTIPART_OVERHEAD_BYTES - 1))
    with pytest.raises(RuntimeError, match="multipart overhead"):
        config.BusinessGatewaySettings.from_env()


@pytest.mark.p1
def test_disabled_gateway_does_not_load_or_register_runtime_components(monkeypatch, gateway_modules):
    monkeypatch.delenv("NOMIX_BG_ENABLED", raising=False)
    gateway_modules("config")
    gateway_package = sys.modules[gateway_modules.package_name]
    app = SimpleNamespace(extensions={})

    gateway_package.register_business_gateway(app)

    assert app.extensions["business_gateway_enabled"] is False
    assert f"{gateway_modules.package_name}.cli" not in sys.modules
    assert f"{gateway_modules.package_name}.routes" not in sys.modules
