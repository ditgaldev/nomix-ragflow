#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import pytest


@pytest.mark.p1
def test_agent_canvas_analysis_is_recursive_and_fail_closed(gateway_modules):
    analyzer = gateway_modules("agent_capabilities")
    errors = gateway_modules("errors")

    safe = {
        "components": {
            "begin": {"obj": {"component_name": "Begin", "params": {}}},
            "agent": {
                "obj": {
                    "component_name": "Agent",
                    "params": {
                        "tools": [
                            {"component_name": "Retrieval", "params": {"datasetIds": ["dataset-a"]}},
                        ],
                        "mcp": [],
                    },
                }
            },
            "message": {"obj": {"component_name": "Message", "params": {}}},
        }
    }
    analysis = analyzer.analyze_agent_dsl(safe, "request-a")
    assert analysis.component_names == {"Begin", "Agent", "Retrieval", "Message"}
    assert analysis.required_actions == {"knowledge:retrieve"}

    for dsl, blocked in (
        ({"components": {"invoke": {"obj": {"component_name": "Invoke", "params": {}}}}}, "Invoke"),
        ({"components": {"agent": {"obj": {"component_name": "Agent", "params": {"mcp": [{"mcp_id": "server-a"}]}}}}}, "MCP"),
        ({"components": {"future": {"obj": {"component_name": "FutureTool", "params": {}}}}}, "FutureTool"),
    ):
        with pytest.raises(errors.BusinessGatewayError) as denied:
            analyzer.analyze_agent_dsl(dsl, "request-a")
        assert (denied.value.status, denied.value.code) == (403, "AGENT_CAPABILITY_NOT_ALLOWED")
        assert blocked in denied.value.details["componentTypes"]
