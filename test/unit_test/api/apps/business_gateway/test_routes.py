#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import asyncio
import hashlib
import sys
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import ModuleType, SimpleNamespace

import pytest
from quart import Quart, request
from werkzeug.datastructures import FileStorage


def _module(name, **members):
    module = ModuleType(name)
    for key, value in members.items():
        setattr(module, key, value)
    return module


@pytest.mark.p1
def test_rest_gateway_returns_401_403_and_keeps_concurrent_contexts_isolated(monkeypatch, gateway_modules):
    package = gateway_modules.package_name
    capabilities = gateway_modules("capabilities")
    errors = gateway_modules("errors")
    types = gateway_modules("types")
    recovery = gateway_modules("recovery")
    recovered_commits = []

    async def authenticate(_request, _introspector):
        authorization = request.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            raise errors.BusinessGatewayError(
                "MISSING_ACCESS_TOKEN",
                "A valid business Bearer access token is required.",
                status=401,
                request_id="request-missing",
            )
        token = authorization.removeprefix("Bearer ")
        suffix = "a" if token == "token-a" else "b"
        actions = capabilities.action_names() if token in {"token-a", "token-b"} else frozenset()
        await asyncio.sleep(0)
        business_context = types.BusinessAuthorizationContext(
            subject=f"subject-{suffix}",
            actor_subject=f"subject-{suffix}",
            on_behalf_of_subject=None,
            workspace_id=f"workspace-{suffix}",
            actions=actions,
            dataset_scope=types.ResourceScope("ids", frozenset({f"dataset-{suffix}"})),
            document_scope=types.ResourceScope("inherit"),
            chat_scope=types.ResourceScope("all"),
            agent_scope=types.ResourceScope("all"),
            memory_scope=types.ResourceScope("all"),
            permission_ref=None,
            authentication_type="token-introspection",
            request_id=f"request-{suffix}",
            authority="https://identity.example.com",
            audience=("nomix-ragflow-data",),
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
            client_id="crm",
            token_use="data",
        )
        return types.RagFlowExecutionContext(
            authorization=business_context,
            tenant_id=f"tenant-{suffix}",
            execution_user_id=f"user-{suffix}",
            workspace_binding_id=f"binding-{suffix}",
            token_fingerprint=hashlib.sha256(token.encode()).hexdigest(),
            entry_point="rest",
        )

    class Policy:
        def __init__(self, context):
            self.context = context

        def prepare(self, capability, path_args, payload, query):
            if not capability.required_actions.issubset(self.context.actions):
                raise errors.BusinessGatewayError(
                    "ACTION_NOT_ALLOWED",
                    "The business subject is not allowed to perform this action.",
                    status=403,
                    request_id=self.context.request_id,
                )
            if capability.operation == "datasets.delete":
                raise errors.BusinessGatewayError(
                    "RESOURCE_NOT_FOUND",
                    "The requested resource was not found.",
                    status=404,
                    request_id=self.context.request_id,
                )
            return self._prepared(capability, path_args, payload, query)

        def prepare_recovery(self, capability, path_args, payload, query, plan):
            assert capability.operation == "datasets.delete"
            assert plan == recovery.RecoveryPlan("dataset-delete", {"datasets": [{"id": "dataset-a"}]})
            return self._prepared(capability, path_args, payload, query)

        def _prepared(self, capability, path_args, payload, query):
            prepared = types.PreparedAuthorization(payload, query, path_args)
            prepared.authorization_seal = types.AuthorizationSeal(
                operation=capability.operation,
                scope_domain="knowledge",
                visibility="tenant-acl",
                workspace_binding_id=self.context.workspace_binding_id,
                tenant_id=self.context.tenant_id,
                subject=self.context.subject,
                scope_hash=f"scope-{self.context.workspace_id}",
                request_hash="request-hash",
            )
            return prepared

    class Adapter:
        async def invoke(self, capability, context, prepared):
            return SimpleNamespace(
                data={
                    "subject": context.subject,
                    "workspaceId": context.workspace_id,
                    "tenantId": context.tenant_id,
                    "datasetScope": sorted(context.dataset_scope.ids),
                },
                meta={},
                passthrough=None,
            )

        async def recover(self, capability, context, prepared, plan):
            if capability.operation == "datasets.create":
                assert plan == recovery.RecoveryPlan("authoritative-probe", {"resourceId": "dataset-recovered"})
                return recovery.RecoveryOutcome("applied", {"id": "dataset-recovered", "name": "Recovered"}, {}, 201)
            assert capability.operation == "datasets.delete"
            assert plan == recovery.RecoveryPlan("dataset-delete", {"datasets": [{"id": "dataset-a"}]})
            return recovery.RecoveryOutcome("applied", {"successCount": 1}, {}, 200)

    reservation = SimpleNamespace(record_id=None, key_hash=None, replay=None, execution_started=False, recovery_required=False)
    recovery_reservation = SimpleNamespace(
        record_id="record-recovered",
        key_hash="k" * 64,
        replay=None,
        execution_started=True,
        recovery_required=True,
    )
    deleted_recovery_reservation = SimpleNamespace(
        record_id="record-deleted",
        key_hash="d" * 64,
        replay=None,
        execution_started=True,
        recovery_required=True,
    )

    def reserve_stub(capability, *args, **kwargs):
        return recovery_reservation if capability.operation == "datasets.create" else reservation

    monkeypatch.setitem(sys.modules, f"{package}.adapter", _module(f"{package}.adapter", RagFlowBusinessServiceAdapter=Adapter))
    monkeypatch.setitem(
        sys.modules,
        f"{package}.audit",
        _module(
            f"{package}.audit",
            append_audit_event=lambda *args, **kwargs: None,
            append_authentication_failure=lambda *args, **kwargs: None,
        ),
    )
    monkeypatch.setitem(sys.modules, f"{package}.auth", _module(f"{package}.auth", authenticate_business_request=authenticate))
    monkeypatch.setitem(
        sys.modules,
        f"{package}.idempotency",
        _module(
            f"{package}.idempotency",
            abandon=lambda value: None,
            complete=lambda *args, **kwargs: None,
            complete_recovered=lambda *args, **kwargs: recovered_commits.append(args),
            execution_intent=lambda value: (
                recovery.RecoveryPlan("dataset-delete", {"datasets": [{"id": "dataset-a"}]})
                if value.record_id == "record-deleted"
                else recovery.RecoveryPlan("authoritative-probe", {"resourceId": "dataset-recovered"})
            ),
            lookup_existing_for_recovery=lambda capability, *args, **kwargs: deleted_recovery_reservation if capability.operation == "datasets.delete" else None,
            mark_executing=lambda value, plan=None: value,
            mark_uncertain=lambda value: None,
            note_recovery_failure=lambda value, reason: None,
            request_fingerprint=lambda *args, **kwargs: "fingerprint",
            reserve=reserve_stub,
        ),
    )
    monkeypatch.setitem(sys.modules, f"{package}.introspection", _module(f"{package}.introspection", TokenIntrospector=object))
    monkeypatch.setitem(sys.modules, f"{package}.policy", _module(f"{package}.policy", AuthorizationPolicy=Policy))
    monkeypatch.setitem(sys.modules, f"{package}.concurrency", _module(f"{package}.concurrency", requires_mutation_lock=lambda operation: False))
    monkeypatch.setitem(sys.modules, "api.db.db_models", _module("api.db.db_models", DB=SimpleNamespace(atomic=nullcontext)))
    routes = gateway_modules("routes")

    app = Quart(__name__)
    app.extensions["business_gateway_introspector"] = object()
    app.extensions["business_gateway_adapter"] = Adapter()
    app.extensions["business_gateway_concurrency"] = SimpleNamespace(acquire_recovery=lambda *args, **kwargs: asyncio.sleep(0, result=None))
    app.extensions["business_gateway_settings"] = routes.BusinessGatewaySettings(
        enabled=True,
        max_file_bytes=512 * 1024,
        max_request_bytes=1024 * 1024,
        readiness_timeout_seconds=1,
    )
    app.extensions["business_gateway_telemetry"] = routes.BusinessGatewayTelemetry()
    app.register_blueprint(routes.business_gateway, url_prefix="/api/business/v1")

    async def run():
        missing = await app.test_client().post("/api/business/v1/retrieval", json={"question": "hello"})
        forbidden = await app.test_client().post(
            "/api/business/v1/retrieval",
            headers={"Authorization": "Bearer token-without-actions"},
            json={"question": "hello"},
        )
        first, second = await asyncio.gather(
            app.test_client().post(
                "/api/business/v1/retrieval",
                headers={"Authorization": "Bearer token-a"},
                json={"question": "hello"},
            ),
            app.test_client().post(
                "/api/business/v1/retrieval",
                headers={"Authorization": "Bearer token-b"},
                json={"question": "hello"},
            ),
        )
        malformed = await app.test_client().post(
            "/api/business/v1/retrieval",
            headers={"Authorization": "Bearer token-a", "Content-Type": "application/json"},
            data=b"{",
        )
        app.extensions["business_gateway_settings"] = routes.BusinessGatewaySettings(
            enabled=True,
            max_file_bytes=4,
            max_request_bytes=8,
            readiness_timeout_seconds=1,
        )
        oversized = await app.test_client().post(
            "/api/business/v1/retrieval",
            headers={"Authorization": "Bearer token-a"},
            json={"question": "this body is too large"},
        )
        app.extensions["business_gateway_settings"] = routes.BusinessGatewaySettings(
            enabled=True,
            max_file_bytes=4,
            max_request_bytes=1024 * 1024,
            readiness_timeout_seconds=1,
        )
        oversized_file = await app.test_client().post(
            "/api/business/v1/datasets/dataset-a/documents",
            headers={"Authorization": "Bearer token-a", "Idempotency-Key": "oversized-file"},
            files={"file": FileStorage(stream=BytesIO(b"12345"), filename="oversized.txt")},
        )
        app.extensions["business_gateway_settings"] = routes.BusinessGatewaySettings(
            enabled=True,
            max_file_bytes=512 * 1024,
            max_request_bytes=1024 * 1024,
            readiness_timeout_seconds=1,
        )
        recovered = await app.test_client().post(
            "/api/business/v1/datasets",
            headers={"Authorization": "Bearer token-a", "Idempotency-Key": "recover-me"},
            json={"name": "Recovered"},
        )
        recovered_delete = await app.test_client().delete(
            "/api/business/v1/datasets/dataset-a",
            headers={"Authorization": "Bearer token-a", "Idempotency-Key": "recover-delete", "If-Match": "1"},
        )
        return (
            (missing.status_code, await missing.get_json()),
            (forbidden.status_code, await forbidden.get_json()),
            (first.status_code, await first.get_json()),
            (second.status_code, await second.get_json()),
            (malformed.status_code, await malformed.get_json()),
            (oversized.status_code, await oversized.get_json()),
            (oversized_file.status_code, await oversized_file.get_json()),
            (
                recovered.status_code,
                await recovered.get_json(),
                recovered.headers.get("X-Idempotency-Recovered"),
                recovered.headers.get("X-Idempotent-Replay"),
            ),
            (
                recovered_delete.status_code,
                await recovered_delete.get_json(),
                recovered_delete.headers.get("X-Idempotency-Recovered"),
            ),
        )

    missing, forbidden, first, second, malformed, oversized, oversized_file, recovered, recovered_delete = asyncio.run(run())
    assert missing[0] == 401
    assert missing[1]["error"]["code"] == "MISSING_ACCESS_TOKEN"
    assert forbidden[0] == 403
    assert forbidden[1]["error"]["code"] == "ACTION_NOT_ALLOWED"
    assert oversized[0] == 413
    assert recovered[0] == 201
    assert recovered[1]["data"]["id"] == "dataset-recovered"
    assert recovered[2:] == ("true", "true")
    assert recovered_delete == (200, {"data": {"successCount": 1}, "meta": {"requestId": "request-a"}}, "true")
    assert len(recovered_commits) == 2
    assert oversized[1]["error"]["code"] == "REQUEST_TOO_LARGE"
    assert oversized_file[0] == 413
    assert oversized_file[1]["error"]["code"] == "FILE_TOO_LARGE"
    assert oversized_file[1]["error"]["details"] == {"actualBytesAtLeast": 5, "maxBytes": 4}
    assert malformed[0] == 400
    assert malformed[1]["error"]["code"] == "INVALID_REQUEST"

    assert first[0] == second[0] == 200
    first_body = first[1]
    second_body = second[1]
    assert first_body["data"] == {
        "subject": "subject-a",
        "workspaceId": "workspace-a",
        "tenantId": "tenant-a",
        "datasetScope": ["dataset-a"],
    }
    assert second_body["data"] == {
        "subject": "subject-b",
        "workspaceId": "workspace-b",
        "tenantId": "tenant-b",
        "datasetScope": ["dataset-b"],
    }
    assert first_body["meta"]["requestId"] == "request-a"
    assert second_body["meta"]["requestId"] == "request-b"
