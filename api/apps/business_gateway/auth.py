#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import hashlib
import re
from typing import Literal

from quart import Request

from common.misc_utils import get_uuid

from .errors import BusinessGatewayError
from .introspection import TokenIntrospector
from .models import BusinessGatewayWorkspaceBinding
from .types import BusinessAuthorizationContext, RagFlowExecutionContext

_BEARER = re.compile(r"^Bearer ([^\s]+)$")
_UNTRUSTED_CONTEXT_HEADERS = frozenset(
    {
        "x-actions",
        "x-data-scope",
        "x-dataset-scope",
        "x-document-scope",
        "x-chat-scope",
        "x-agent-scope",
        "x-memory-scope",
        "x-workspace",
        "x-workspace-id",
        "x-subject",
        "x-actor-subject",
        "x-on-behalf-of-subject",
        "x-tenant",
        "x-tenant-id",
        "x-permission-ref",
        "x-nomix-actions",
        "x-nomix-data-scope",
        "x-nomix-dataset-scope",
        "x-nomix-document-scope",
        "x-nomix-chat-scope",
        "x-nomix-agent-scope",
        "x-nomix-memory-scope",
        "x-nomix-workspace",
        "x-nomix-workspace-id",
        "x-nomix-subject",
        "x-nomix-actor-subject",
        "x-nomix-on-behalf-of-subject",
        "x-nomix-tenant",
        "x-nomix-tenant-id",
        "x-nomix-permission-ref",
    }
)


async def authenticate_business_request(
    request: Request,
    introspector: TokenIntrospector,
) -> RagFlowExecutionContext:
    request_id = get_uuid()
    # Werkzeug Headers iterates over (name, value) pairs; keys() is required here.
    spoofed = sorted(name for name in request.headers.keys() if name.lower() in _UNTRUSTED_CONTEXT_HEADERS)  # noqa: SIM118
    if spoofed:
        raise BusinessGatewayError(
            "UNTRUSTED_AUTHORIZATION_CONTEXT",
            "Authorization context headers are not accepted.",
            status=400,
            request_id=request_id,
            details={"headers": spoofed},
        )
    entry_point = _request_entry_point(request, request_id)

    authorization = request.headers.get("Authorization", "")
    match = _BEARER.fullmatch(authorization)
    if match is None or not match.group(1) or len(match.group(1)) > 16_384:
        raise BusinessGatewayError(
            "MISSING_ACCESS_TOKEN" if not authorization else "INVALID_ACCESS_TOKEN",
            "A valid business Bearer access token is required.",
            status=401,
            request_id=request_id,
        )
    token = match.group(1)
    claims = await introspector.introspect(token, request_id)

    binding = BusinessGatewayWorkspaceBinding.get_or_none((BusinessGatewayWorkspaceBinding.authority == claims.authority) & (BusinessGatewayWorkspaceBinding.workspace_id == claims.workspace_id))
    if binding is None or not binding.active:
        raise BusinessGatewayError(
            "WORKSPACE_NOT_ALLOWED",
            "The business workspace is not enabled for this service.",
            status=403,
            request_id=request_id,
        )
    if _has_active_mapping_conflict(binding):
        raise BusinessGatewayError(
            "WORKSPACE_MAPPING_CONFLICT",
            "The business workspace mapping is ambiguous and has been disabled until an administrator resolves it.",
            status=403,
            request_id=request_id,
        )

    authorization_context = BusinessAuthorizationContext(
        subject=claims.subject,
        actor_subject=claims.actor_subject,
        on_behalf_of_subject=claims.on_behalf_of_subject,
        workspace_id=claims.workspace_id,
        actions=claims.actions,
        dataset_scope=claims.dataset_scope,
        document_scope=claims.document_scope,
        chat_scope=claims.chat_scope,
        agent_scope=claims.agent_scope,
        memory_scope=claims.memory_scope,
        permission_ref=claims.permission_ref,
        authentication_type="token-introspection",
        request_id=request_id,
        authority=claims.authority,
        audience=claims.audience,
        expires_at=claims.expires_at,
        client_id=claims.client_id,
        token_use=claims.token_use,
    )
    return RagFlowExecutionContext(
        authorization=authorization_context,
        tenant_id=binding.tenant_id,
        execution_user_id=binding.execution_user_id,
        workspace_binding_id=binding.id,
        token_fingerprint=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        entry_point=entry_point,
    )


def _request_entry_point(request: Request, request_id: str) -> Literal["rest", "agent"]:
    values = request.headers.getlist("X-Nomix-Call-Source")
    if not values:
        return "rest"
    if len(values) != 1 or values[0] not in {"rest", "agent"}:
        raise BusinessGatewayError(
            "CALL_SOURCE_INVALID",
            "X-Nomix-Call-Source must be exactly rest or agent.",
            status=400,
            request_id=request_id,
        )
    return values[0]


def _has_active_mapping_conflict(binding) -> bool:
    base = (BusinessGatewayWorkspaceBinding.active == 1) & (BusinessGatewayWorkspaceBinding.id != binding.id)
    tenant_conflict = BusinessGatewayWorkspaceBinding.get_or_none(base & (BusinessGatewayWorkspaceBinding.tenant_id == binding.tenant_id))
    if tenant_conflict is not None:
        return True
    execution_conflict = BusinessGatewayWorkspaceBinding.get_or_none(base & (BusinessGatewayWorkspaceBinding.execution_user_id == binding.execution_user_id))
    return execution_conflict is not None
