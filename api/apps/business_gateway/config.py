#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024
MIN_MULTIPART_OVERHEAD_BYTES = 8 * 1024 * 1024
DEFAULT_MAX_REQUEST_BYTES = DEFAULT_MAX_FILE_BYTES + MIN_MULTIPART_OVERHEAD_BYTES
MAX_REQUEST_BYTES = 1024 * 1024 * 1024
MAX_FILE_BYTES = MAX_REQUEST_BYTES - MIN_MULTIPART_OVERHEAD_BYTES


@dataclass(frozen=True)
class BusinessGatewaySettings:
    enabled: bool
    max_file_bytes: int
    max_request_bytes: int
    readiness_timeout_seconds: float

    @classmethod
    def from_env(cls) -> BusinessGatewaySettings:
        max_file_bytes = _bounded_integer(
            "NOMIX_BG_MAX_FILE_BYTES",
            DEFAULT_MAX_FILE_BYTES,
            minimum=1,
            maximum=MAX_FILE_BYTES,
        )
        max_request_bytes = _bounded_integer(
            "NOMIX_BG_MAX_REQUEST_BYTES",
            DEFAULT_MAX_REQUEST_BYTES,
            minimum=1,
            maximum=MAX_REQUEST_BYTES,
        )
        if max_request_bytes < max_file_bytes + MIN_MULTIPART_OVERHEAD_BYTES:
            raise RuntimeError(
                "NOMIX_BG_MAX_REQUEST_BYTES must be at least "
                f"NOMIX_BG_MAX_FILE_BYTES + {MIN_MULTIPART_OVERHEAD_BYTES} bytes of multipart overhead"
            )
        return cls(
            enabled=_boolean("NOMIX_BG_ENABLED", False),
            max_file_bytes=max_file_bytes,
            max_request_bytes=max_request_bytes,
            readiness_timeout_seconds=_positive_float("NOMIX_BG_READINESS_TIMEOUT_SECONDS", 5.0),
        )


def _boolean(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be a boolean")


def _bounded_integer(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _positive_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a number") from error
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


__all__ = [
    "DEFAULT_MAX_FILE_BYTES",
    "DEFAULT_MAX_REQUEST_BYTES",
    "MAX_FILE_BYTES",
    "MAX_REQUEST_BYTES",
    "MIN_MULTIPART_OVERHEAD_BYTES",
    "BusinessGatewaySettings",
]
