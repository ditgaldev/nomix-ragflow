from __future__ import annotations

import os

import pytest

from scripts.business_gateway_live_data_plane import run_gate


def _float_env(name: str, default: str) -> float:
    return float(os.getenv(name, "").strip() or default)


@pytest.mark.integration
def test_deployed_business_gateway_real_data_plane():
    base_url = os.getenv("NOMIX_BG_TEST_BASE_URL")
    if not base_url:
        pytest.skip("set NOMIX_BG_TEST_BASE_URL to run the deployed live data-plane gate")
    token_a = os.getenv("NOMIX_BG_TEST_ACCESS_TOKEN_A")
    token_b = os.getenv("NOMIX_BG_TEST_ACCESS_TOKEN_B")
    assert token_a and token_b, "two NOMIX_BG_TEST_ACCESS_TOKEN_* values are required when the live gate is enabled"
    assert os.getenv("NOMIX_BG_LIVE_ALLOW_WRITES", "").lower() == "true", "live data-plane writes require NOMIX_BG_LIVE_ALLOW_WRITES=true"

    run_gate(
        base_url,
        token_a,
        token_b,
        ca_file=os.getenv("NOMIX_BG_TEST_CA_FILE"),
        allow_writes=True,
        parse_timeout_seconds=_float_env("NOMIX_BG_TEST_PARSE_TIMEOUT_SECONDS", "300"),
        poll_interval_seconds=_float_env("NOMIX_BG_TEST_POLL_INTERVAL_SECONDS", "2"),
        request_timeout_seconds=_float_env("NOMIX_BG_TEST_REQUEST_TIMEOUT_SECONDS", "30"),
        report_file=os.getenv("NOMIX_BG_TEST_REPORT_FILE"),
    )
