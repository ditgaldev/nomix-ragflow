#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import asyncio
from collections import Counter
from datetime import UTC, datetime, timedelta

import pytest


def _settings(module):
    return module.IntrospectionSettings(
        url="https://identity.example.com/oauth2/introspect",
        authority="https://identity.example.com",
        audience="nomix-ragflow-data",
        auth_mode="basic",
        client_id="gateway",
        client_secret="server-only",
        ca_file=None,
        cert_file=None,
        key_file=None,
        timeout_seconds=1,
        retries=0,
        cache_seconds=30,
    )


def _claims(*, workspace="workspace-a", dataset="dataset-a"):
    return {
        "active": True,
        "subject": f"subject:{workspace}",
        "actorSubject": f"actor:{workspace}",
        "workspaceId": workspace,
        "actions": ["knowledge:retrieve", "dataset:read"],
        "datasetScope": {"mode": "ids", "ids": [dataset]},
        "documentScope": {"mode": "inherit"},
        "chatScope": {"mode": "ids", "ids": [f"chat:{workspace}"]},
        "agentScope": {"mode": "ids", "ids": [f"agent:{workspace}"]},
        "memoryScope": {"mode": "ids", "ids": [f"memory:{workspace}"]},
        "expiresAt": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
        "audience": ["nomix-ragflow-data"],
        "tokenUse": "data",
        "iss": "https://identity.example.com",
    }


@pytest.mark.p1
def test_introspection_validates_contract_and_fails_closed(monkeypatch, gateway_modules):
    module = gateway_modules("introspection")
    errors = gateway_modules("errors")
    introspector = module.TokenIntrospector(_settings(module))

    parsed = introspector._parse(_claims(), "request-1")
    assert parsed.subject == "subject:workspace-a"
    assert parsed.actor_subject == "actor:workspace-a"
    assert parsed.token_use == "data"
    assert parsed.dataset_scope.ids == {"dataset-a"}
    assert parsed.document_scope.mode == "inherit"
    assert parsed.chat_scope.ids == {"chat:workspace-a"}
    assert parsed.agent_scope.ids == {"agent:workspace-a"}
    assert parsed.memory_scope.ids == {"memory:workspace-a"}
    assert introspector._parse({**_claims(), "crmRoleVersion": 7}, "request-extension").subject == parsed.subject
    permission_reference = introspector._parse({**_claims(), "permissionRef": "grant-a"}, "request-permission-ref")
    assert permission_reference.permission_ref == "grant-a"
    assert permission_reference.dataset_scope.ids == {"dataset-a"}

    cases = [
        ({**_claims(), "active": False}, 401, "INVALID_ACCESS_TOKEN"),
        ({key: value for key, value in _claims().items() if key != "actions"}, 503, "AUTH_CONTEXT_INCOMPLETE"),
        ({**_claims(), "actions": []}, 503, "AUTH_CONTEXT_INCOMPLETE"),
        ({key: value for key, value in _claims().items() if key != "actorSubject"}, 503, "AUTH_CONTEXT_INCOMPLETE"),
        ({key: value for key, value in _claims().items() if key != "datasetScope"}, 503, "AUTH_CONTEXT_INCOMPLETE"),
        ({key: value for key, value in _claims().items() if key != "documentScope"}, 503, "AUTH_CONTEXT_INCOMPLETE"),
        ({key: value for key, value in _claims().items() if key != "chatScope"}, 503, "AUTH_CONTEXT_INCOMPLETE"),
        ({key: value for key, value in _claims().items() if key != "agentScope"}, 503, "AUTH_CONTEXT_INCOMPLETE"),
        ({key: value for key, value in _claims().items() if key != "memoryScope"}, 503, "AUTH_CONTEXT_INCOMPLETE"),
        ({**_claims(), "datasetScope": None}, 503, "AUTH_CONTEXT_INCOMPLETE"),
        ({**_claims(), "documentScope": None}, 503, "AUTH_CONTEXT_INCOMPLETE"),
        ({**_claims(), "audience": ["another-service"]}, 403, "TOKEN_NOT_ALLOWED"),
        ({**_claims(), "iss": "https://attacker.example.com"}, 403, "TOKEN_NOT_ALLOWED"),
    ]
    for raw, status, code in cases:
        with pytest.raises(errors.BusinessGatewayError) as captured:
            introspector._parse(raw, "request-2")
        assert (captured.value.status, captured.value.code) == (status, code)

    redirected = {}

    class Content:
        async def read(self, _limit):
            return b""

    class Response:
        status = 302
        content = Content()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    class Session:
        def __init__(self, **_kwargs):
            self.closed = False

        async def close(self):
            self.closed = True

        def post(self, _url, **kwargs):
            redirected.update(kwargs)
            return Response()

    monkeypatch.setattr(module.aiohttp, "ClientSession", Session)
    monkeypatch.setattr(module.aiohttp, "TCPConnector", lambda **_kwargs: object())
    with pytest.raises(errors.BusinessGatewayError) as redirect_error:
        asyncio.run(introspector._request("business-token", "request-redirect"))
    assert (redirect_error.value.status, redirect_error.value.code) == (503, "AUTH_SERVICE_UNAVAILABLE")
    assert redirected["allow_redirects"] is False
    asyncio.run(introspector.close())

    empty_secret = module.TokenIntrospector(module.IntrospectionSettings(**{**_settings(module).__dict__, "client_secret": ""}))
    with pytest.raises(errors.BusinessGatewayError) as secret_error:
        asyncio.run(empty_secret._request("business-token", "request-secret"))
    assert (secret_error.value.status, secret_error.value.code) == (503, "AUTH_SERVICE_UNAVAILABLE")


@pytest.mark.p1
def test_introspection_reuses_one_lifecycle_managed_session(monkeypatch, gateway_modules):
    module = gateway_modules("introspection")
    created = []
    posts = []

    class Content:
        async def read(self, _limit):
            return b'{"active":false}'

    class Response:
        status = 200
        content = Content()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    class Session:
        def __init__(self, **kwargs):
            self.closed = False
            created.append(kwargs)

        def post(self, url, **kwargs):
            posts.append((url, kwargs["data"]["token"]))
            return Response()

        async def close(self):
            self.closed = True

    monkeypatch.setattr(module.aiohttp, "ClientSession", Session)
    monkeypatch.setattr(module.aiohttp, "TCPConnector", lambda **kwargs: ("connector", kwargs))

    async def run():
        introspector = module.TokenIntrospector(_settings(module))
        assert await introspector._request("token-a", "request-a") == {"active": False}
        assert await introspector._request("token-b", "request-b") == {"active": False}
        assert introspector.running()
        await introspector.close()
        assert not introspector.running()

    asyncio.run(run())
    assert len(created) == 1
    assert posts == [
        ("https://identity.example.com/oauth2/introspect", "token-a"),
        ("https://identity.example.com/oauth2/introspect", "token-b"),
    ]


@pytest.mark.p1
def test_token_rotation_and_concurrent_subjects_never_share_cached_scope(gateway_modules):
    module = gateway_modules("introspection")

    class StubIntrospector(module.TokenIntrospector):
        def __init__(self):
            super().__init__(_settings(module))
            self.calls = Counter()

        async def _request(self, token, request_id):
            self.calls[token] += 1
            await asyncio.sleep(0)
            suffix = "a" if token == "token-a" else "b"
            return _claims(workspace=f"workspace-{suffix}", dataset=f"dataset-{suffix}")

    async def run():
        introspector = StubIntrospector()
        first_a, first_b, second_a = await asyncio.gather(
            introspector.introspect("token-a", "request-a1"),
            introspector.introspect("token-b", "request-b"),
            introspector.introspect("token-a", "request-a2"),
        )
        return introspector, first_a, first_b, second_a

    introspector, first_a, first_b, second_a = asyncio.run(run())
    assert first_a is second_a
    assert first_a.workspace_id == "workspace-a" and first_a.dataset_scope.ids == {"dataset-a"}
    assert first_b.workspace_id == "workspace-b" and first_b.dataset_scope.ids == {"dataset-b"}
    assert introspector.calls == {"token-a": 1, "token-b": 1}
    assert "token-a" not in introspector._cache and "token-b" not in introspector._cache


@pytest.mark.p1
def test_error_sanitization_never_emits_credentials(gateway_modules):
    sanitize = gateway_modules("errors").sanitize
    value = sanitize(
        {
            "authorization": "Bearer business-token",
            "nested": {"apiKey": "ragflow-secret", "message": "failed for Bearer another-token"},
        }
    )

    assert value["authorization"] == "[REDACTED]"
    assert value["nested"]["apiKey"] == "[REDACTED]"
    assert value["nested"]["message"] == "failed for Bearer [REDACTED]"
