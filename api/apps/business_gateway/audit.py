#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import hashlib
import re
from typing import Any

from common.misc_utils import get_uuid

from .capabilities import Capability
from .errors import sanitize
from .models import BusinessGatewayAuditEvent
from .types import PreparedAuthorization, RagFlowExecutionContext

_BEARER = re.compile(r"^Bearer ([^\s]+)$")
_UNVERIFIED = "<unverified>"


def append_audit_event(
    context: RagFlowExecutionContext,
    capability: Capability,
    prepared: PreparedAuthorization | None,
    *,
    status: int,
    outcome: str,
    duration_ms: int,
    idempotency_key_hash: str | None,
    details: Any = None,
) -> None:
    audit_details = {"clientId": context.client_id}
    if isinstance(details, dict):
        audit_details.update(details)
    elif details is not None:
        audit_details["result"] = details
    resource_ids = {
        "datasets": sorted(prepared.dataset_ids) if prepared else [],
        "documents": sorted(prepared.document_ids) if prepared else [],
        "chats": sorted(prepared.chat_ids) if prepared else [],
        "agents": sorted(prepared.agent_ids) if prepared else [],
        "memories": sorted(prepared.memory_ids) if prepared else [],
        "path": prepared.path_args if prepared else {},
    }
    BusinessGatewayAuditEvent.create(
        id=get_uuid(),
        request_id=context.request_id,
        subject=context.subject,
        actor_subject=context.actor_subject,
        on_behalf_of_subject=context.on_behalf_of_subject,
        workspace_id=context.workspace_id,
        tenant_id=context.tenant_id,
        permission_ref=context.permission_ref,
        authentication_type=context.authentication_type,
        entry_point=context.entry_point,
        operation=capability.operation,
        action=capability.required_action,
        resource_type=capability.resource_type,
        resource_ids=sanitize(resource_ids),
        outcome=outcome,
        http_status=status,
        idempotency_key_hash=idempotency_key_hash,
        token_fingerprint=context.token_fingerprint,
        duration_ms=max(0, duration_ms),
        details=sanitize(audit_details),
    )


def append_authentication_failure(
    authorization: str,
    capability: Capability,
    *,
    request_id: str,
    status: int,
    outcome: str,
    duration_ms: int,
    error_code: str,
) -> None:
    """Persist failures that occur before an authorization context exists."""

    match = _BEARER.fullmatch(authorization)
    token = match.group(1) if match is not None else ""
    fingerprint_source = token if token else "<no-business-token>"
    BusinessGatewayAuditEvent.create(
        id=get_uuid(),
        request_id=request_id,
        subject=_UNVERIFIED,
        actor_subject=_UNVERIFIED,
        on_behalf_of_subject=None,
        workspace_id=_UNVERIFIED,
        tenant_id=_UNVERIFIED,
        permission_ref=None,
        authentication_type="token-introspection",
        entry_point="rest",
        operation=capability.operation,
        action=capability.required_action,
        resource_type=capability.resource_type,
        resource_ids={},
        outcome=outcome,
        http_status=status,
        idempotency_key_hash=None,
        token_fingerprint=hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest(),
        duration_ms=max(0, duration_ms),
        details={"errorCode": error_code, "tokenPresented": bool(token)},
    )
