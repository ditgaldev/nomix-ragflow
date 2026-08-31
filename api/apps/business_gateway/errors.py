#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import re
from typing import Any

from quart import jsonify

_SECRET_KEY = re.compile(r"(authorization|access.?token|api.?key|client.?secret|password)", re.IGNORECASE)
_BEARER = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+")


def sanitize(value: Any) -> Any:
    """Remove credentials from values that can reach errors, audit, or logs."""

    if isinstance(value, dict):
        return {str(key): "[REDACTED]" if _SECRET_KEY.search(str(key)) else sanitize(member) for key, member in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize(member) for member in value]
    if isinstance(value, str):
        return _BEARER.sub("Bearer [REDACTED]", value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)


class BusinessGatewayError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int,
        request_id: str | None = None,
        details: Any = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.request_id = request_id
        self.details = sanitize(details)
        self.retryable = retryable

    def with_request_id(self, request_id: str) -> BusinessGatewayError:
        if self.request_id is None:
            self.request_id = request_id
        return self


def error_response(error: BusinessGatewayError):
    payload: dict[str, Any] = {
        "error": {
            "code": error.code,
            "message": error.message,
            "requestId": error.request_id or "unknown",
            "retryable": error.retryable,
        }
    }
    if error.details is not None:
        payload["error"]["details"] = error.details
    response = jsonify(payload)
    response.status_code = error.status
    response.headers["Cache-Control"] = "no-store"
    if error.request_id:
        response.headers["X-Request-Id"] = error.request_id
    return response


def resource_not_found(request_id: str | None = None) -> BusinessGatewayError:
    return BusinessGatewayError(
        "RESOURCE_NOT_FOUND",
        "The requested resource was not found.",
        status=404,
        request_id=request_id,
    )
