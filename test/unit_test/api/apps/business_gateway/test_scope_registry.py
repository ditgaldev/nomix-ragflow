#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest


@pytest.mark.p1
def test_authorization_seal_binds_operation_context_scope_and_prepared_request(gateway_modules):
    types = gateway_modules("types")
    registry = gateway_modules("scope_registry")
    errors = gateway_modules("errors")
    authorization = types.BusinessAuthorizationContext(
        subject="subject-a",
        actor_subject="actor-a",
        on_behalf_of_subject=None,
        workspace_id="workspace-a",
        actions=frozenset({"dataset:read"}),
        dataset_scope=types.ResourceScope("ids", frozenset({"dataset-a"})),
        document_scope=types.ResourceScope("inherit"),
        chat_scope=types.ResourceScope("ids", frozenset({"chat-a"})),
        agent_scope=types.ResourceScope("ids", frozenset({"agent-a"})),
        memory_scope=types.ResourceScope("ids", frozenset({"memory-a"})),
        permission_ref="permission-a",
        authentication_type="token-introspection",
        request_id="request-a",
        authority="https://identity.example.com",
        audience=("nomix-ragflow-data",),
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
        client_id="crm",
        token_use="data",
    )
    context = types.RagFlowExecutionContext(
        authorization=authorization,
        tenant_id="tenant-a",
        execution_user_id="user-a",
        workspace_binding_id="binding-a",
        token_fingerprint="f" * 64,
        entry_point="rest",
    )
    public_context = authorization.to_public_dict()
    assert public_context["datasetScope"] == {"mode": "ids", "ids": ["dataset-a"]}
    assert public_context["chatScope"] == {"mode": "ids", "ids": ["chat-a"]}
    assert not {"tenantId", "executionUserId", "workspaceBindingId", "tokenFingerprint", "entryPoint"} & set(public_context)
    prepared = types.PreparedAuthorization(None, {"limit": 10}, {})
    prepared.authorization_seal = registry.issue_authorization_seal(
        "datasets.list",
        context,
        prepared,
        allowed_dataset_ids=frozenset({"dataset-a"}),
        allowed_document_ids=frozenset(),
    )
    verified = registry.verify_authorization_seal("datasets.list", context, prepared)
    assert verified.scope_hash == prepared.authorization_seal.scope_hash

    prepared.query["limit"] = 20
    with pytest.raises(errors.BusinessGatewayError) as tampered:
        registry.verify_authorization_seal("datasets.list", context, prepared)
    assert (tampered.value.status, tampered.value.code) == (500, "AUTHORIZATION_BOUNDARY_FAILURE")
