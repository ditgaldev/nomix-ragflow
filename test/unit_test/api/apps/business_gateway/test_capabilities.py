#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

EXPECTED_ACTIONS = {
    "authorization:read",
    "knowledge:retrieve",
    "dataset:read",
    "dataset:create",
    "dataset:update",
    "dataset:delete",
    "document:read",
    "document:upload",
    "document:update",
    "document:delete",
    "document:parse",
    "compilation:write",
    "chunk:read",
    "chunk:create",
    "chunk:update",
    "chunk:delete",
    "chat:read",
    "chat:create",
    "chat:update",
    "chat:delete",
    "session:read",
    "session:create",
    "session:update",
    "session:delete",
    "session:invoke",
    "agent:read",
    "agent:create",
    "agent:update",
    "agent:delete",
    "memory:read",
    "memory:create",
    "memory:update",
    "memory:delete",
    "memory-message:read",
    "memory-message:create",
    "memory-message:update",
    "memory-message:delete",
}

EXPECTED_TOOLS = {
    "ragflow_discover",
    "ragflow_retrieval",
    "ragflow_page_index",
    "ragflow_manage_datasets",
    "ragflow_manage_documents",
    "ragflow_transfer_documents",
    "ragflow_manage_chunks",
    "ragflow_manage_chats",
    "ragflow_manage_sessions",
    "ragflow_manage_agents",
    "ragflow_manage_memories",
}


@pytest.mark.p1
def test_manifest_is_canonical_closed_and_complete(gateway_modules):
    module = gateway_modules("capabilities")
    value = module.manifest()
    operations = value["operations"]

    assert (value["standardVersion"], value["service"], value["plane"]) == ("v1", "nomix-ragflow", "data")
    assert module.action_names() == EXPECTED_ACTIONS
    assert {item["agentTool"] for item in operations if item.get("agentTool")} == EXPECTED_TOOLS
    agent_operations = [item for item in operations if item.get("agentTool")]
    assert all(item.get("agentAction") for item in agent_operations)
    assert all(not item.get("agentAction") and not item.get("agentKind") for item in operations if not item.get("agentTool"))
    assert len({(item["agentTool"], item["agentAction"], item.get("agentKind")) for item in agent_operations}) == len(agent_operations)
    assert len({item["operation"] for item in operations}) == len(operations)
    assert len({(item["method"], item["path"]) for item in operations}) == len(operations)
    assert all(item["path"].startswith("/") and not item["path"].startswith("/api/") for item in operations)
    assert all(item["risk"] in {"read", "write", "destructive"} for item in operations)
    assert all(item["idempotency"] in {"none", "supported", "required"} for item in operations)
    assert "deleteAll" not in json.dumps(value)
    assert "apiKey" not in json.dumps(value)


@pytest.mark.p1
def test_openapi_is_derived_from_manifest(gateway_modules):
    capabilities = gateway_modules("capabilities")
    openapi = gateway_modules("openapi").build_openapi()
    expected = {(item.method, f"/api/v1{item.path}", item.operation) for item in capabilities.capabilities()}
    actual = {(method.upper(), path, operation["operationId"]) for path, methods in openapi["paths"].items() for method, operation in methods.items()}

    assert openapi["openapi"] == "3.1.0"
    assert expected == actual
    for item in capabilities.capabilities():
        operation = openapi["paths"][f"/api/v1{item.path}"][item.method.lower()]
        assert operation["x-nomix-required-action"] == item.required_action
        assert operation["x-nomix-idempotency"] == item.idempotency
        expected_concurrency = "required" if capabilities.requires_resource_version(item.operation) else "none"
        assert operation["x-nomix-optimistic-concurrency"] == expected_concurrency
        assert operation["x-nomix-client-method"] == item.client_method
        assert operation["security"] == [{"businessAccessToken": []}]
        assert "413" in operation["responses"]
        if "requestBody" in operation:
            schema = next(iter(operation["requestBody"]["content"].values()))["schema"]
            assert schema["additionalProperties"] is False
        if item.agent_tool:
            assert operation["x-nomix-agent-tool"] == item.agent_tool
            assert operation["x-nomix-agent-action"] == item.agent_action
            if item.agent_kind:
                assert operation["x-nomix-agent-kind"] == item.agent_kind

    upload = openapi["paths"]["/api/v1/datasets/{datasetId}/documents"]["post"]
    assert "201" in upload["responses"]
    assert "multipart/form-data" in upload["requestBody"]["content"]
    start_parse = openapi["paths"]["/api/v1/datasets/{datasetId}/documents:parse"]["post"]
    assert "202" in start_parse["responses"]
    page_index_build = openapi["paths"]["/api/v1/datasets/{datasetId}/documents:build-page-index"]["post"]
    assert "202" in page_index_build["responses"]
    assert page_index_build["x-nomix-required-action"] == "compilation:write"
    page_index_search = openapi["paths"]["/api/v1/page-index/retrieval"]["post"]
    page_index_search_schema = page_index_search["requestBody"]["content"]["application/json"]["schema"]
    assert page_index_search_schema["properties"]["datasetIds"]["maxItems"] == 20
    assert page_index_search_schema["properties"]["documentIds"]["maxItems"] == 20

    retrieval = openapi["paths"]["/api/v1/retrieval"]["post"]
    assert all(parameter["name"] != "Idempotency-Key" for parameter in retrieval.get("parameters", []))
    dataset_create = openapi["paths"]["/api/v1/datasets"]["post"]
    idempotency = next(parameter for parameter in dataset_create["parameters"] if parameter["name"] == "Idempotency-Key")
    assert idempotency["required"] is True
    dataset_update = openapi["paths"]["/api/v1/datasets/{datasetId}"]["patch"]
    if_match = next(parameter for parameter in dataset_update["parameters"] if parameter["name"] == "If-Match")
    assert if_match["required"] is True
    assert "428" in dataset_update["responses"]

    dataset_get = openapi["paths"]["/api/v1/datasets/{datasetId}"]["get"]
    assert all(parameter["name"] not in {"cursor", "limit"} for parameter in dataset_get["parameters"])
    dataset_list = openapi["paths"]["/api/v1/datasets"]["get"]
    assert {parameter["name"] for parameter in dataset_list["parameters"]} >= {"cursor", "limit"}

    download = openapi["paths"]["/api/v1/datasets/{datasetId}/documents/{documentId}/content"]["get"]
    assert "application/octet-stream" in download["responses"]["200"]["content"]
    assert "application/json" not in download["responses"]["200"]["content"]
    assert download["x-nomix-agent-tool"] == "ragflow_transfer_documents"
    assert download["x-nomix-agent-action"] == "download"

    gateway_context = openapi["paths"]["/api/v1/gateway-context"]["get"]
    context_schema = gateway_context["responses"]["200"]["content"]["application/json"]["schema"]
    assert context_schema == {"$ref": "#/components/schemas/AuthorizationContextResponse"}
    assert openapi["components"]["schemas"]["BusinessAuthorizationContext"]["additionalProperties"] is False
    assert set(openapi["components"]["schemas"]["BusinessAuthorizationContext"]["required"]) >= {"datasetScope", "documentScope", "chatScope", "agentScope", "memoryScope"}

    batch_create = openapi["paths"]["/api/v1/memory-messages:batch-create"]["post"]
    assert "201" in batch_create["responses"]


@pytest.mark.p1
def test_every_json_operation_has_an_exact_generated_response_contract(gateway_modules):
    capabilities = gateway_modules("capabilities")
    response_contracts = gateway_modules("response_contracts")
    openapi = gateway_modules("openapi").build_openapi()
    json_operations = {item.operation for item in capabilities.capabilities() if item.operation != "documents.download"}

    assert set(response_contracts.RESPONSE_DATA_CONTRACTS) == json_operations
    assert all(schema["additionalProperties"] is False for schema in response_contracts.RESOURCE_SCHEMAS.values())
    components = openapi["components"]["schemas"]
    response_refs = set()
    for item in capabilities.capabilities():
        if item.operation == "documents.download":
            continue
        operation = openapi["paths"][f"/api/v1{item.path}"][item.method.lower()]
        success = next(value for status, value in operation["responses"].items() if status.startswith("2"))
        response_ref = success["content"]["application/json"]["schema"]["$ref"]
        component_name = response_contracts.response_component_name(item.operation)
        assert response_ref == f"#/components/schemas/{component_name}"
        response_refs.add(response_ref)
        schema = components[component_name]
        assert schema["required"] == ["data", "meta"]
        assert schema["additionalProperties"] is False
        assert schema["properties"]["data"] != {}

    assert len(response_refs) == len(json_operations)

    projected = response_contracts.project_response_data(
        "datasets.get",
        {
            "id": "dataset-a",
            "version": 4,
            "name": "Authorized",
            "tenantId": "must-not-leak",
            "parserConfig": {"customOption": True},
        },
    )
    assert projected == {
        "id": "dataset-a",
        "version": 4,
        "name": "Authorized",
        "parserConfig": {"customOption": True},
    }
    with pytest.raises(RuntimeError, match="datasets.get produced data outside"):
        response_contracts.project_response_data("datasets.get", {"id": "dataset-a", "name": "missing-version"})


@pytest.mark.p1
def test_every_operation_has_a_closed_runtime_request_contract(gateway_modules):
    capabilities = gateway_modules("capabilities")
    contracts = gateway_modules("contracts")
    errors = gateway_modules("errors")

    assert set(contracts.CONTRACTS) == {item.operation for item in capabilities.capabilities()}
    for contract in contracts.CONTRACTS.values():
        for schema in (contract.body, contract.query, contract.multipart):
            if schema is not None:
                assert schema["additionalProperties"] is False

    with pytest.raises(errors.BusinessGatewayError) as forged:
        contracts.validate_request("retrieval.search", {"question": "hello", "tenantId": "forged"}, {})
    assert (forged.value.status, forged.value.code) == (400, "INVALID_REQUEST")

    with pytest.raises(errors.BusinessGatewayError) as nested_forgery:
        contracts.validate_request(
            "chatSessions.invoke",
            {"question": "hello", "extra": {"tenant_id": "forged"}},
            {},
        )
    assert (nested_forgery.value.status, nested_forgery.value.code) == (400, "INVALID_REQUEST")


@pytest.mark.p1
def test_every_operation_has_a_scope_rule_and_nested_resources_require_parent_read(gateway_modules):
    capabilities = gateway_modules("capabilities")
    scope_registry = gateway_modules("scope_registry")
    operations = capabilities.capability_by_operation()

    assert set(scope_registry.SCOPE_RULES) == set(operations)
    assert operations["documents.update"].required_actions >= {"document:update", "dataset:read"}
    assert operations["chunks.delete"].required_actions >= {"chunk:delete", "document:read", "dataset:read"}
    assert operations["chatSessions.invoke"].required_actions >= {"session:invoke", "session:read", "chat:read", "knowledge:retrieve"}
    assert operations["agentSessions.invoke"].required_actions >= {"session:invoke", "session:read", "agent:read", "knowledge:retrieve"}
    assert operations["memoryMessages.search"].required_actions >= {"memory-message:read", "memory:read"}
    assert operations["pageIndex.get"].required_actions >= {"document:read", "dataset:read"}
    assert operations["pageIndex.status"].required_actions >= {"document:read", "dataset:read"}
    assert operations["pageIndex.build"].required_actions >= {
        "compilation:write",
        "dataset:read",
        "document:read",
        "document:update",
        "document:parse",
    }
    assert operations["pageIndex.search"].required_actions >= {"knowledge:retrieve", "document:read", "dataset:read"}


@pytest.mark.p1
def test_dedicated_proxy_exposes_only_business_plane():
    root = Path(__file__).resolve().parents[5]
    proxy = (root / "docker" / "nginx" / "business-gateway.conf.template").read_text(encoding="utf-8")
    compose = (root / "docker" / "docker-compose-business-gateway.yml").read_text(encoding="utf-8")

    assert "location ^~ /api/v1/" in proxy
    assert "rewrite ^/api/v1/(.*)$ /api/business/v1/$1 break;" in proxy
    assert 'proxy_set_header X-Nomix-Call-Source "";' not in proxy
    assert proxy.count("proxy_pass") == 1
    assert "location / {\n        return 404;" in proxy
    assert "NOMIX_BG_INTROSPECTION_URL" in compose
    assert "NOMIX_BG_CONCURRENCY_LOCK_SECONDS" in compose
    assert "NOMIX_BG_ENABLED" in compose
    assert "BUSINESS_GATEWAY_TLS_CERT_FILE" in compose
    assert "listen 8443 ssl;" in proxy
    assert "location = /api/v1/_metrics" in proxy
    assert "client_max_body_size ${BUSINESS_GATEWAY_MAX_BODY_SIZE};" in proxy
    assert "NOMIX_BG_MAX_FILE_BYTES" in compose
    assert "NOMIX_BG_MAX_REQUEST_BYTES" in compose
    assert "NOMIX_BG_PROXY_MAX_REQUEST_BYTES" in compose
    assert "BUSINESS_GATEWAY_MAX_BODY_SIZE\" -gt \"$$BUSINESS_GATEWAY_REQUEST_BODY_SIZE" in compose
    assert "NOMIX_BG_AGENT_CLIENT_IDS" not in compose
    assert "ragflow-cpu:" in compose and "ragflow-gpu:" in compose

    gate = (root / ".github" / "workflows" / "business-gateway-production-gate.yml").read_text(encoding="utf-8")
    assert "vars.NOMIX_BG_TEST_BASE_URL" in gate
    assert "secrets.NOMIX_BG_TEST_ACCESS_TOKEN_A" in gate
    assert "secrets.NOMIX_BG_TEST_ACCESS_TOKEN_B" in gate
    assert "NOMIX_BG_LIVE_ALLOW_WRITES" in gate
    assert "scripts.business_gateway_live_data_plane" in gate
    assert "cancel-in-progress: false" in gate
    assert "inputs.base_url" not in gate

    alerts = (root / "docker" / "monitoring" / "business-gateway-alerts.yml").read_text(encoding="utf-8")
    guide = (root / "docs" / "develop" / "business_gateway_integration.md").read_text(encoding="utf-8")
    assert "#idempotency-reconciliation-runbook" in alerts
    assert "#production-release-runbook" in alerts
    assert 'id="idempotency-reconciliation-runbook"' in guide
    assert 'id="production-release-runbook"' in guide

    ci = (root / ".github" / "workflows" / "tests.yml").read_text(encoding="utf-8")
    assert "Verify Business Gateway Python 3.13 boundary" in ci
    assert "pytest -q test/unit_test/api/apps/business_gateway" in ci
    assert "ruff format --check api/apps/business_gateway" in ci


@pytest.mark.p1
def test_gateway_schema_and_nomix_release_docs_cannot_drift_from_their_owners():
    root = Path(__file__).resolve().parents[5]
    guide = (root / "docs" / "develop" / "business_gateway_integration.md").read_text(encoding="utf-8")
    models = (root / "api" / "apps" / "business_gateway" / "models.py").read_text(encoding="utf-8")
    table_names = set(re.findall(r'db_table = "(business_gateway_[^"]+)"', models))

    assert table_names
    assert all(f"- `{table_name}`" in guide for table_name in table_names)

    workflow = (root / ".github" / "workflows" / "release-nomix-plugin.yml").read_text(encoding="utf-8")
    branch_only_pack = "if: github.event_name == 'push' && github.ref == 'refs/heads/npm-nomix-ragflow' && matrix.os == 'ubuntu-latest'"
    pack_step = workflow.split("- name: Pack and audit", 1)[1].split("shell:", 1)[0]
    assert branch_only_pack in pack_step
    assert "Verify release tag points to this commit" in workflow
    assert 'tag="nomix-v$version"' in workflow
    assert 'git rev-parse "$tag^{commit}"' in workflow
    assert "if: github.event_name == 'push' && github.ref == 'refs/heads/npm-nomix-ragflow'" in workflow.split("publish:", 1)[1]

    readme = (root / "integrations" / "nomix-harness" / "README.md").read_text(encoding="utf-8")
    readme_zh = (root / "integrations" / "nomix-harness" / "README.zh.md").read_text(encoding="utf-8")
    for release_doc in (readme, readme_zh):
        assert "nomix-v<version>" in release_doc
        assert "npm-nomix-ragflow" in release_doc
        assert "ragflow_page_index" in release_doc
        assert "pageIndex.search" in release_doc

    assert "page-index/retrieval" in guide
    assert "fallbackUsed=false" in guide


@pytest.mark.p1
def test_adapter_has_no_rest_handler_bridge():
    root = Path(__file__).resolve().parents[5]
    source = (root / "api" / "apps" / "business_gateway" / "adapter.py").read_text(encoding="utf-8")

    assert "test_request_context" not in source
    assert "view_functions" not in source
    assert "url_map" not in source
    assert "LegacyTarget" not in source
    assert "def _target(" not in source
    assert "No RAGFlow Business service command is registered" in source
    assert '"path": dict(prepared.path_args)' in source


@pytest.mark.p1
def test_business_authorization_stays_out_of_native_ragflow_business_modules():
    root = Path(__file__).resolve().parents[5]
    native_modules = (
        "api/apps/restful_apis/chat_api.py",
        "api/apps/restful_apis/memory_api.py",
        "api/apps/services/memory_api_service.py",
        "api/db/db_models.py",
        "api/utils/commands.py",
        "memory/services/messages.py",
    )

    for relative_path in native_modules:
        source = (root / relative_path).read_text(encoding="utf-8")
        assert "api.apps.business_gateway" not in source
        assert "BusinessAuthorizationContext" not in source
        assert "business_subject" not in source


@pytest.mark.p1
def test_gateway_does_not_become_a_second_business_grant_authority():
    root = Path(__file__).resolve().parents[5]
    gateway = root / "api" / "apps" / "business_gateway"
    combined = "\n".join((gateway / name).read_text(encoding="utf-8") for name in ("auth.py", "models.py", "policy.py", "cli.py"))

    assert "BusinessGatewayResourceGrant" not in combined
    assert 'command("grant")' not in combined
    assert 'command("revoke")' not in combined
    assert "permission_ref ==" not in combined
    removal_migration = gateway / "migrations" / "v0002_remove_local_grant_authority.py"
    assert "DROP TABLE IF EXISTS business_gateway_resource_grant" in removal_migration.read_text(encoding="utf-8")


@pytest.mark.p1
def test_mysql_forward_migration_makes_audit_storage_append_only(monkeypatch, gateway_modules):
    migration = gateway_modules("migrations.v0003_append_only_audit")

    statements = []

    class Cursor:
        @staticmethod
        def fetchone():
            return None

    class RetryingPooledMySQLDatabase:
        @staticmethod
        def execute_sql(sql, params=None):
            statements.append((sql, params))
            return Cursor()

    migration.apply(RetryingPooledMySQLDatabase(), ())

    trigger_sql = [sql for sql, _params in statements if sql.startswith("CREATE TRIGGER")]
    assert len(trigger_sql) == 2
    assert any("BEFORE UPDATE" in sql for sql in trigger_sql)
    assert any("BEFORE DELETE" in sql for sql in trigger_sql)
    assert all("Business Gateway audit events are append-only" in sql for sql in trigger_sql)
