#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest


@pytest.mark.p1
def test_cursor_is_authenticated_and_bound_to_principal_operation_and_filters(gateway_modules):
    types = gateway_modules("types")
    errors = gateway_modules("errors")
    cursor = gateway_modules("cursor")
    codec = cursor.CursorCodec("a-stable-test-secret-that-is-longer-than-32-bytes")

    def context(subject: str):
        authorization = types.BusinessAuthorizationContext(
            subject=subject,
            actor_subject=subject,
            on_behalf_of_subject=None,
            workspace_id="workspace-a",
            actions=frozenset(),
            dataset_scope=types.ResourceScope("all"),
            document_scope=types.ResourceScope("inherit"),
            permission_ref="permission-a",
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

    encoded = codec.encode("datasets.list", context("subject-a"), {"name": "one", "limit": 10}, (100, "z"), (90, "m"), "scope-a")
    decoded = codec.decode(encoded, "datasets.list", context("subject-a"), {"name": "one", "limit": 20}, "scope-a")
    assert decoded.snapshot == (100, "z")
    assert decoded.after == (90, "m")

    for operation, principal, filters, value, scope_hash in (
        ("documents.list", context("subject-a"), {"name": "one"}, encoded, "scope-a"),
        ("datasets.list", context("subject-b"), {"name": "one"}, encoded, "scope-a"),
        ("datasets.list", context("subject-a"), {"name": "two"}, encoded, "scope-a"),
        ("datasets.list", context("subject-a"), {"name": "one"}, encoded, "scope-b"),
        ("datasets.list", context("subject-a"), {"name": "one"}, encoded[:-1] + ("A" if encoded[-1] != "A" else "B"), "scope-a"),
    ):
        with pytest.raises(errors.BusinessGatewayError) as invalid:
            codec.decode(value, operation, principal, filters, scope_hash)
        assert (invalid.value.status, invalid.value.code) == (400, "INVALID_CURSOR")
