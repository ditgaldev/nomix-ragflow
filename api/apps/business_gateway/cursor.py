#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any

from .errors import BusinessGatewayError
from .types import RagFlowExecutionContext


@dataclass(frozen=True)
class KeysetCursor:
    snapshot: tuple[int, str]
    after: tuple[int, str]


class CursorCodec:
    """Authenticated cursor bound to one operation, principal and filter set."""

    def __init__(self, secret: str | None):
        self._secret = secret.encode("utf-8") if secret and len(secret.encode("utf-8")) >= 32 else None

    def configured(self) -> bool:
        return self._secret is not None

    def encode(
        self,
        operation: str,
        context: RagFlowExecutionContext,
        filters: dict[str, Any],
        snapshot: tuple[int, str],
        after: tuple[int, str],
        authorization_scope_hash: str,
    ) -> str:
        secret = self._require_secret(context.request_id)
        payload = {
            "v": 2,
            "op": operation,
            "principal": self._principal(context, authorization_scope_hash),
            "filters": self._filters(filters),
            "snapshot": list(snapshot),
            "after": list(after),
        }
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        signature = hmac.new(secret, raw, hashlib.sha256).digest()
        return _b64(raw + signature)

    def decode(
        self,
        cursor: str,
        operation: str,
        context: RagFlowExecutionContext,
        filters: dict[str, Any],
        authorization_scope_hash: str,
    ) -> KeysetCursor:
        secret = self._require_secret(context.request_id)
        try:
            signed = _unb64(cursor)
            if _b64(signed) != cursor:
                raise ValueError
            raw, supplied = signed[:-32], signed[-32:]
            expected = hmac.new(secret, raw, hashlib.sha256).digest()
            if not hmac.compare_digest(supplied, expected):
                raise ValueError
            payload = json.loads(raw)
            if (
                payload.get("v") != 2
                or payload.get("op") != operation
                or payload.get("principal") != self._principal(context, authorization_scope_hash)
                or payload.get("filters") != self._filters(filters)
            ):
                raise ValueError
            snapshot = _key(payload["snapshot"])
            after = _key(payload["after"])
            return KeysetCursor(snapshot, after)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError, binascii.Error) as error:
            raise BusinessGatewayError("INVALID_CURSOR", "The pagination cursor is invalid for this request.", status=400, request_id=context.request_id) from error

    def _require_secret(self, request_id: str) -> bytes:
        if self._secret is None:
            raise BusinessGatewayError(
                "CURSOR_UNAVAILABLE",
                "The Business Gateway cursor service is not configured.",
                status=503,
                request_id=request_id,
                retryable=False,
            )
        return self._secret

    @staticmethod
    def _principal(context: RagFlowExecutionContext, authorization_scope_hash: str) -> str:
        value = {
            "workspaceBindingId": context.workspace_binding_id,
            "tenantId": context.tenant_id,
            "executionUserId": context.execution_user_id,
            "subject": context.subject,
            "permissionRef": context.permission_ref,
            "datasetScope": {"mode": context.dataset_scope.mode, "ids": sorted(context.dataset_scope.ids)},
            "documentScope": {"mode": context.document_scope.mode, "ids": sorted(context.document_scope.ids)},
            "chatScope": {"mode": context.chat_scope.mode, "ids": sorted(context.chat_scope.ids)},
            "agentScope": {"mode": context.agent_scope.mode, "ids": sorted(context.agent_scope.ids)},
            "memoryScope": {"mode": context.memory_scope.mode, "ids": sorted(context.memory_scope.ids)},
            "authorizationScopeHash": authorization_scope_hash,
        }
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(raw.encode()).hexdigest()

    @staticmethod
    def _filters(filters: dict[str, Any]) -> str:
        value = {key: member for key, member in filters.items() if key not in {"cursor", "limit"}}
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(raw.encode()).hexdigest()


def _key(value: Any) -> tuple[int, str]:
    if not isinstance(value, list) or len(value) != 2 or not isinstance(value[0], int) or not isinstance(value[1], str):
        raise ValueError
    return value[0], value[1]


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
