#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime, timedelta
from types import ModuleType, SimpleNamespace
from uuid import uuid4

import pytest
from werkzeug.datastructures import Headers


class _Expr:
    def __init__(self, clauses):
        self.clauses = list(clauses)

    def __and__(self, other):
        return _Expr([*self.clauses, *other.clauses])


class _Field:
    def __init__(self, name):
        self.name = name

    def __eq__(self, value):
        return _Expr([(self.name, "eq", value)])

    def __ne__(self, value):
        return _Expr([(self.name, "ne", value)])


def _install_auth_stubs(monkeypatch, bindings, package_name):
    db_models = ModuleType("api.db.db_models")

    class WorkspaceBinding:
        id = _Field("id")
        authority = _Field("authority")
        workspace_id = _Field("workspace_id")
        tenant_id = _Field("tenant_id")
        execution_user_id = _Field("execution_user_id")
        active = _Field("active")

        @classmethod
        def get_or_none(cls, expression):
            for (authority, workspace_id), binding in bindings.items():
                values = {**vars(binding), "authority": authority, "workspace_id": workspace_id}
                if all((values.get(name) == expected) if operator == "eq" else (values.get(name) != expected) for name, operator, expected in expression.clauses):
                    return binding
            return None

    monkeypatch.setitem(sys.modules, "api.db.db_models", db_models)
    gateway_models = ModuleType(f"{package_name}.models")
    gateway_models.BusinessGatewayWorkspaceBinding = WorkspaceBinding
    monkeypatch.setitem(sys.modules, f"{package_name}.models", gateway_models)

    misc = ModuleType("common.misc_utils")
    misc.get_uuid = lambda: uuid4().hex
    monkeypatch.setitem(sys.modules, "common.misc_utils", misc)


def _claims(types, workspace, dataset):
    return types.IntrospectionClaims(
        authority="https://identity.example.com",
        subject=f"subject:{workspace}",
        actor_subject=f"actor:{workspace}",
        on_behalf_of_subject=None,
        workspace_id=workspace,
        actions=frozenset({"knowledge:retrieve"}),
        dataset_scope=types.ResourceScope("ids", frozenset({dataset})),
        document_scope=types.ResourceScope("inherit"),
        chat_scope=types.ResourceScope("ids", frozenset({f"chat:{workspace}"})),
        agent_scope=types.ResourceScope("ids", frozenset({f"agent:{workspace}"})),
        memory_scope=types.ResourceScope("ids", frozenset({f"memory:{workspace}"})),
        permission_ref=None,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
        audience=("nomix-ragflow-data",),
        client_id="crm",
        token_use="data",
    )


@pytest.mark.p1
def test_authentication_requires_verified_bearer_and_rejects_spoofed_context(monkeypatch, gateway_modules):
    bindings = {}
    _install_auth_stubs(monkeypatch, bindings, gateway_modules.package_name)
    auth = gateway_modules("auth")
    errors = gateway_modules("errors")

    class NeverCalled:
        async def introspect(self, token, request_id):
            raise AssertionError("introspection must not run")

    with pytest.raises(errors.BusinessGatewayError) as missing:
        asyncio.run(auth.authenticate_business_request(SimpleNamespace(headers=Headers()), NeverCalled()))
    assert (missing.value.status, missing.value.code) == (401, "MISSING_ACCESS_TOKEN")

    headers = Headers({"Authorization": "Bearer opaque-token", "X-Tenant-Id": "forged"})
    with pytest.raises(errors.BusinessGatewayError) as spoofed:
        asyncio.run(auth.authenticate_business_request(SimpleNamespace(headers=headers), NeverCalled()))
    assert (spoofed.value.status, spoofed.value.code) == (400, "UNTRUSTED_AUTHORIZATION_CONTEXT")


@pytest.mark.p1
def test_concurrent_business_users_keep_token_workspace_tenant_and_scope_isolated(monkeypatch, gateway_modules):
    bindings = {
        ("https://identity.example.com", "workspace-a"): SimpleNamespace(id="binding-a", tenant_id="tenant-a", execution_user_id="user-a", active=True),
        ("https://identity.example.com", "workspace-b"): SimpleNamespace(id="binding-b", tenant_id="tenant-b", execution_user_id="user-b", active=True),
    }
    _install_auth_stubs(monkeypatch, bindings, gateway_modules.package_name)
    types = gateway_modules("types")
    auth = gateway_modules("auth")

    class Introspector:
        async def introspect(self, token, request_id):
            await asyncio.sleep(0)
            suffix = "a" if token == "token-a" else "b"
            return _claims(types, f"workspace-{suffix}", f"dataset-{suffix}")

    async def run():
        return await asyncio.gather(
            auth.authenticate_business_request(SimpleNamespace(headers=Headers({"Authorization": "Bearer token-a"})), Introspector()),
            auth.authenticate_business_request(SimpleNamespace(headers=Headers({"Authorization": "Bearer token-b"})), Introspector()),
        )

    first, second = asyncio.run(run())
    assert (first.subject, first.workspace_id, first.tenant_id, first.dataset_scope.ids) == (
        "subject:workspace-a",
        "workspace-a",
        "tenant-a",
        {"dataset-a"},
    )
    assert (second.subject, second.workspace_id, second.tenant_id, second.dataset_scope.ids) == (
        "subject:workspace-b",
        "workspace-b",
        "tenant-b",
        {"dataset-b"},
    )
    assert first.token_fingerprint != second.token_fingerprint
    assert first.chat_scope.ids == {"chat:workspace-a"}
    assert second.memory_scope.ids == {"memory:workspace-b"}


@pytest.mark.p1
def test_workspace_mapping_is_one_to_one_and_entry_point_is_audit_only(monkeypatch, gateway_modules):
    bindings = {
        ("https://identity.example.com", "workspace-a"): SimpleNamespace(id="binding-a", tenant_id="tenant-shared", execution_user_id="user-a", active=True),
        ("https://identity.example.com", "workspace-b"): SimpleNamespace(id="binding-b", tenant_id="tenant-shared", execution_user_id="user-b", active=True),
    }
    _install_auth_stubs(monkeypatch, bindings, gateway_modules.package_name)
    types = gateway_modules("types")
    auth = gateway_modules("auth")
    errors = gateway_modules("errors")

    class Introspector:
        async def introspect(self, token, request_id):
            return _claims(types, "workspace-a", "dataset-a")

    with pytest.raises(errors.BusinessGatewayError) as conflict:
        asyncio.run(
            auth.authenticate_business_request(
                SimpleNamespace(headers=Headers({"Authorization": "Bearer opaque-token"})),
                Introspector(),
            )
        )
    assert (conflict.value.status, conflict.value.code) == (403, "WORKSPACE_MAPPING_CONFLICT")

    bindings.pop(("https://identity.example.com", "workspace-b"))
    context = asyncio.run(
        auth.authenticate_business_request(
            SimpleNamespace(headers=Headers({"Authorization": "Bearer opaque-token", "X-Nomix-Call-Source": "agent"})),
            Introspector(),
        )
    )
    assert context.entry_point == "agent"
    assert context.authorization.client_id == "crm"

    with pytest.raises(errors.BusinessGatewayError) as invalid_source:
        asyncio.run(
            auth.authenticate_business_request(
                SimpleNamespace(
                    headers=Headers(
                        {
                            "Authorization": "Bearer opaque-token",
                            "X-Nomix-Call-Source": "browser",
                        }
                    )
                ),
                Introspector(),
            )
        )
    assert (invalid_source.value.status, invalid_source.value.code) == (400, "CALL_SOURCE_INVALID")


def _install_policy_stubs(monkeypatch, package_name):
    db_models = ModuleType("api.db.db_models")
    for name in (
        "API4Conversation",
        "Conversation",
        "Dialog",
        "Document",
        "Knowledgebase",
        "Memory",
        "UserCanvas",
    ):
        setattr(db_models, name, type(name, (), {}))
    monkeypatch.setitem(sys.modules, "api.db.db_models", db_models)
    document_service = ModuleType("api.db.services.document_service")
    document_service.DocumentService = type("DocumentService", (), {})
    monkeypatch.setitem(sys.modules, "api.db.services.document_service", document_service)
    knowledgebase_service = ModuleType("api.db.services.knowledgebase_service")
    knowledgebase_service.KnowledgebaseService = type("KnowledgebaseService", (), {})
    monkeypatch.setitem(sys.modules, "api.db.services.knowledgebase_service", knowledgebase_service)

    constants = ModuleType("common.constants")
    constants.StatusEnum = SimpleNamespace(VALID=SimpleNamespace(value="1"))
    monkeypatch.setitem(sys.modules, "common.constants", constants)
    misc = ModuleType("common.misc_utils")
    misc.get_uuid = lambda: uuid4().hex
    monkeypatch.setitem(sys.modules, "common.misc_utils", misc)


def _context(
    types,
    actions,
    *,
    dataset_mode="ids",
    document_mode="inherit",
    chat_mode="all",
    agent_mode="all",
    memory_mode="all",
    permission_ref=None,
):
    authorization = types.BusinessAuthorizationContext(
        subject="subject-a",
        actor_subject="actor-a",
        on_behalf_of_subject=None,
        workspace_id="workspace-a",
        actions=frozenset(actions),
        dataset_scope=types.ResourceScope(dataset_mode, frozenset({"dataset-a"}) if dataset_mode == "ids" else frozenset()),
        document_scope=types.ResourceScope(document_mode),
        chat_scope=types.ResourceScope(chat_mode),
        agent_scope=types.ResourceScope(agent_mode),
        memory_scope=types.ResourceScope(memory_mode),
        permission_ref=permission_ref,
        authentication_type="token-introspection",
        request_id="request-a",
        authority="https://identity.example.com",
        audience=("nomix-ragflow-data",),
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
        client_id="crm",
        token_use="data",
    )
    return types.RagFlowExecutionContext(
        authorization=authorization,
        tenant_id="tenant-a",
        execution_user_id="user-a",
        workspace_binding_id="binding-a",
        token_fingerprint="f" * 64,
        entry_point="rest",
    )


@pytest.mark.p1
def test_policy_enforces_action_scope_and_server_selected_retrieval(monkeypatch, gateway_modules):
    _install_policy_stubs(monkeypatch, gateway_modules.package_name)
    capabilities = gateway_modules("capabilities")
    types = gateway_modules("types")
    errors = gateway_modules("errors")
    policy_module = gateway_modules("policy")
    retrieval = capabilities.capability_by_operation()["retrieval.search"]

    denied = policy_module.AuthorizationPolicy(_context(types, set()))
    with pytest.raises(errors.BusinessGatewayError) as action_error:
        denied.prepare(retrieval, {}, {"question": "hello"}, {})
    assert (action_error.value.status, action_error.value.code) == (403, "ACTION_NOT_ALLOWED")

    allowed = policy_module.AuthorizationPolicy(_context(types, retrieval.required_actions))
    allowed.dataset_ids = lambda: frozenset({"dataset-a", "dataset-b"})
    prepared = allowed.prepare(retrieval, {}, {"question": "hello"}, {})
    assert prepared.payload["datasetIds"] == ["dataset-a", "dataset-b"]

    scoped = policy_module.AuthorizationPolicy(_context(types, retrieval.required_actions))
    scoped.dataset_ids = lambda: frozenset({"dataset-a"})
    with pytest.raises(errors.BusinessGatewayError) as scope_error:
        scoped.prepare(retrieval, {}, {"question": "hello", "datasetIds": ["dataset-b"]}, {})
    assert (scope_error.value.status, scope_error.value.code) == (404, "RESOURCE_NOT_FOUND")


@pytest.mark.p1
def test_policy_rejects_forged_context_bad_id_schema_and_unreachable_creation(monkeypatch, gateway_modules):
    _install_policy_stubs(monkeypatch, gateway_modules.package_name)
    capabilities = gateway_modules("capabilities")
    types = gateway_modules("types")
    errors = gateway_modules("errors")
    policy_module = gateway_modules("policy")
    retrieval = capabilities.capability_by_operation()["retrieval.search"]

    for payload, query in [
        ({"question": "hello", "tenantId": "forged"}, {}),
        ({"question": "hello", "permission": "team"}, {}),
        ({"question": "hello", "userId": "another-business-subject"}, {}),
        ({"question": "hello", "metadataCondition": {"apiKey": "must-not-pass"}}, {}),
        ({"question": "hello"}, {"actions": "dataset:delete"}),
        ({"question": "hello"}, {"ownerIds": "tenant-b"}),
        ({"question": "hello"}, {"userId": "another-business-subject"}),
    ]:
        policy = policy_module.AuthorizationPolicy(_context(types, retrieval.required_actions))
        with pytest.raises(errors.BusinessGatewayError) as captured:
            policy.prepare(retrieval, {}, payload, query)
        assert (captured.value.status, captured.value.code) == (400, "UNTRUSTED_AUTHORIZATION_CONTEXT")

    policy = policy_module.AuthorizationPolicy(_context(types, retrieval.required_actions))
    with pytest.raises(errors.BusinessGatewayError) as bad_ids:
        policy.prepare(retrieval, {}, {"question": "hello", "datasetIds": "dataset-a"}, {})
    assert (bad_ids.value.status, bad_ids.value.code) == (400, "INVALID_REQUEST")

    for legacy_payload in [
        {"question": "hello", "dataset_ids": ["dataset-a"]},
        {"question": "hello", "pageSize": 10},
    ]:
        policy = policy_module.AuthorizationPolicy(_context(types, retrieval.required_actions))
        with pytest.raises(errors.BusinessGatewayError) as legacy_schema:
            policy.prepare(retrieval, {}, legacy_payload, {})
        assert (legacy_schema.value.status, legacy_schema.value.code) == (400, "INVALID_REQUEST")

    create_agent = capabilities.capability_by_operation()["agents.create"]
    policy = policy_module.AuthorizationPolicy(_context(types, create_agent.required_actions))
    policy.dataset_ids = lambda: frozenset({"dataset-a"})
    with pytest.raises(errors.BusinessGatewayError) as nested_scope:
        policy.prepare(
            create_agent,
            {},
            {"title": "agent", "dsl": {"components": [{"kb_ids": ["dataset-b"]}]}},
            {},
        )
    assert (nested_scope.value.status, nested_scope.value.code) == (404, "RESOURCE_NOT_FOUND")

    upload = capabilities.capability_by_operation()["documents.upload"]
    policy = policy_module.AuthorizationPolicy(_context(types, upload.required_actions, document_mode="none", permission_ref=None))
    policy.dataset_ids = lambda: frozenset({"dataset-a"})
    prepared = policy.prepare(upload, {"dataset_id": "dataset-a"}, {}, {})
    assert prepared.dataset_ids == {"dataset-a"}


@pytest.mark.p1
def test_chunk_batch_preflights_every_explicit_id_before_adapter(monkeypatch, gateway_modules):
    _install_policy_stubs(monkeypatch, gateway_modules.package_name)
    capabilities = gateway_modules("capabilities")
    types = gateway_modules("types")
    policy_module = gateway_modules("policy")
    capability = capabilities.capability_by_operation()["chunks.batchDelete"]
    policy = policy_module.AuthorizationPolicy(_context(types, capability.required_actions))
    policy._require_dataset_ids = lambda ids: None
    policy._require_document_ids = lambda ids, datasets: None
    observed = []
    policy._require_chunk_ids = lambda ids, dataset, document: observed.append((ids, dataset, document))

    policy.prepare(
        capability,
        {"dataset_id": "dataset-a", "document_id": "document-a"},
        {"ids": ["chunk-a", "chunk-b"]},
        {},
    )

    assert observed == [(["chunk-a", "chunk-b"], "dataset-a", "document-a")]


@pytest.mark.p1
def test_persisted_chat_and_agent_dataset_references_are_scope_checked(monkeypatch, gateway_modules):
    _install_policy_stubs(monkeypatch, gateway_modules.package_name)
    capabilities = gateway_modules("capabilities")
    types = gateway_modules("types")
    errors = gateway_modules("errors")
    policy_module = gateway_modules("policy")

    class DialogStub:
        id = _Field("id")

        @classmethod
        def get_or_none(cls, _expression):
            return SimpleNamespace(tenant_id="tenant-a", kb_ids=["dataset-b"])

    policy_module.Dialog = DialogStub
    chat_invoke = capabilities.capability_by_operation()["chatSessions.invoke"]
    chat_policy = policy_module.AuthorizationPolicy(_context(types, chat_invoke.required_actions))
    chat_policy.dataset_ids = lambda: frozenset({"dataset-a"})
    with pytest.raises(errors.BusinessGatewayError) as chat_scope:
        chat_policy._require_tenant_resources(
            chat_invoke.operation,
            {"chat_id": "chat-a", "session_id": "session-a"},
            {"question": "hello"},
            {},
        )
    assert (chat_scope.value.status, chat_scope.value.code) == (404, "RESOURCE_NOT_FOUND")

    class UserCanvasStub:
        id = _Field("id")

        @classmethod
        def get_or_none(cls, _expression):
            return SimpleNamespace(
                user_id="tenant-a",
                canvas_category="agent_canvas",
                dsl='{"components":{"retrieval":{"obj":{"component_name":"Retrieval","params":{"kb_ids":["dataset-b"]}}}}}',
            )

    policy_module.UserCanvas = UserCanvasStub
    agent_get = capabilities.capability_by_operation()["agents.get"]
    agent_policy = policy_module.AuthorizationPolicy(_context(types, agent_get.required_actions))
    agent_policy.dataset_ids = lambda: frozenset({"dataset-a"})
    with pytest.raises(errors.BusinessGatewayError) as agent_scope:
        agent_policy._require_tenant_resources(agent_get.operation, {"agent_id": "agent-a"}, None, {})
    assert (agent_scope.value.status, agent_scope.value.code) == (404, "RESOURCE_NOT_FOUND")


@pytest.mark.p1
def test_chat_agent_and_memory_scopes_are_enforced_before_resource_access(monkeypatch, gateway_modules):
    _install_policy_stubs(monkeypatch, gateway_modules.package_name)
    capabilities = gateway_modules("capabilities").capability_by_operation()
    types = gateway_modules("types")
    errors = gateway_modules("errors")
    policy_module = gateway_modules("policy")

    cases = (
        ("chats.get", {"chat_id": "chat-denied"}, "chat_ids"),
        ("agents.get", {"agent_id": "agent-denied"}, "agent_ids"),
        ("memories.get", {"memory_id": "memory-denied"}, "memory_ids"),
    )
    for operation, path, resolver_name in cases:
        capability = capabilities[operation]
        policy = policy_module.AuthorizationPolicy(_context(types, capability.required_actions))
        setattr(policy, resolver_name, lambda: frozenset())
        with pytest.raises(errors.BusinessGatewayError) as denied:
            policy.prepare(capability, path, None, {})
        assert (denied.value.status, denied.value.code) == (404, "RESOURCE_NOT_FOUND")

    for operation, resolver_name in (
        ("chats.list", "chat_ids"),
        ("agents.list", "agent_ids"),
        ("memories.list", "memory_ids"),
    ):
        capability = capabilities[operation]
        policy = policy_module.AuthorizationPolicy(_context(types, capability.required_actions))
        setattr(policy, resolver_name, lambda: frozenset())
        prepared = policy.prepare(capability, {}, None, {})
        assert prepared.has_empty_result and prepared.empty_result == []
