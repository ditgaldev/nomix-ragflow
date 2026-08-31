from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest


@pytest.mark.integration
def test_deployed_business_gateway_production_gate():
    base_url = os.getenv("NOMIX_BG_TEST_BASE_URL")
    if not base_url:
        pytest.skip("set NOMIX_BG_TEST_BASE_URL to run the deployed Gateway integration gate")
    access_token = os.getenv("NOMIX_BG_TEST_ACCESS_TOKEN")
    assert access_token, "NOMIX_BG_TEST_ACCESS_TOKEN is required when the deployment gate is enabled"

    script = Path(__file__).resolve().parents[3] / "scripts" / "verify-business-gateway-deployment.py"
    spec = importlib.util.spec_from_file_location("business_gateway_deployment_gate", script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.run_gate(base_url, access_token, os.getenv("NOMIX_BG_TEST_CA_FILE"))
