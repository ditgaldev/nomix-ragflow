#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime
from time import monotonic
from typing import Any
from urllib.parse import urlsplit

import aiohttp

from .errors import BusinessGatewayError
from .telemetry import BusinessGatewayTelemetry
from .types import IntrospectionClaims, ResourceScope

MAX_RESPONSE_BYTES = 64 * 1024
MAX_CACHE_ENTRIES = 4_096
LOCK_STRIPES = 64
_ACTION_PATTERN = re.compile(r"^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$")


@dataclass(frozen=True)
class IntrospectionSettings:
    url: str
    authority: str
    audience: str
    auth_mode: str
    client_id: str | None
    client_secret: str | None
    ca_file: str | None
    cert_file: str | None
    key_file: str | None
    timeout_seconds: float
    retries: int
    cache_seconds: float
    max_connections: int = 100

    @classmethod
    def from_env(cls) -> IntrospectionSettings:
        url = os.getenv("NOMIX_BG_INTROSPECTION_URL", "").strip()
        authority = os.getenv("NOMIX_BG_AUTHORITY", "").strip()
        if not authority and url:
            parsed = urlsplit(url)
            authority = f"{parsed.scheme}://{parsed.netloc}"
        return cls(
            url=url,
            authority=authority,
            audience=os.getenv("NOMIX_BG_AUDIENCE", "nomix-ragflow-data").strip(),
            auth_mode=os.getenv("NOMIX_BG_INTROSPECTION_AUTH_MODE", "basic").strip().lower(),
            client_id=os.getenv("NOMIX_BG_INTROSPECTION_CLIENT_ID"),
            client_secret=os.getenv("NOMIX_BG_INTROSPECTION_CLIENT_SECRET"),
            ca_file=os.getenv("NOMIX_BG_INTROSPECTION_CA_FILE"),
            cert_file=os.getenv("NOMIX_BG_INTROSPECTION_CERT_FILE"),
            key_file=os.getenv("NOMIX_BG_INTROSPECTION_KEY_FILE"),
            timeout_seconds=_positive_float("NOMIX_BG_INTROSPECTION_TIMEOUT_SECONDS", 3.0),
            retries=_non_negative_int("NOMIX_BG_INTROSPECTION_RETRIES", 1),
            cache_seconds=_non_negative_float("NOMIX_BG_INTROSPECTION_CACHE_SECONDS", 5.0),
            max_connections=_positive_int("NOMIX_BG_INTROSPECTION_MAX_CONNECTIONS", 100),
        )


def _positive_float(name: str, default: float) -> float:
    value = float(os.getenv(name, str(default)))
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


def _non_negative_float(name: str, default: float) -> float:
    value = float(os.getenv(name, str(default)))
    if value < 0:
        raise RuntimeError(f"{name} must not be negative")
    return value


def _non_negative_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value < 0:
        raise RuntimeError(f"{name} must not be negative")
    return value


def _positive_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


class TokenIntrospector:
    """RFC 7662 client with bounded responses and token-fingerprint caching."""

    def __init__(
        self,
        settings: IntrospectionSettings | None = None,
        telemetry: BusinessGatewayTelemetry | None = None,
    ) -> None:
        self.settings = settings or IntrospectionSettings.from_env()
        self.telemetry = telemetry
        self._cache: dict[str, tuple[float, IntrospectionClaims]] = {}
        self._locks = tuple(asyncio.Lock() for _ in range(LOCK_STRIPES))
        self._start_lock = asyncio.Lock()
        self._session: aiohttp.ClientSession | None = None
        self._headers: dict[str, str] | None = None
        self._ssl_context: ssl.SSLContext | bool | None = None

    async def start(self, request_id: str = "startup") -> None:
        if self._session is not None and not self._session.closed:
            return
        async with self._start_lock:
            if self._session is not None and not self._session.closed:
                return
            headers, ssl_context = self._transport(request_id)
            timeout = aiohttp.ClientTimeout(total=self.settings.timeout_seconds)
            connector = aiohttp.TCPConnector(limit=self.settings.max_connections, ssl=ssl_context)
            self._headers = headers
            self._ssl_context = ssl_context
            self._session = aiohttp.ClientSession(timeout=timeout, connector=connector)

    async def close(self) -> None:
        session, self._session = self._session, None
        self._headers = None
        self._ssl_context = None
        if session is not None and not session.closed:
            await session.close()

    def configured(self) -> bool:
        try:
            self._transport("readiness")
        except BusinessGatewayError:
            return False
        return True

    def running(self) -> bool:
        return self.configured() and self._session is not None and not self._session.closed

    async def probe(self, request_id: str = "readiness") -> bool:
        """Validate transport and RFC 7662 reachability with a non-secret token."""

        value = await self._request("nomix-business-gateway-readiness-probe", request_id)
        return isinstance(value.get("active"), bool)

    async def introspect(self, token: str, request_id: str) -> IntrospectionClaims:
        fingerprint = hashlib.sha256(token.encode("utf-8")).hexdigest()
        cached = self._cache.get(fingerprint)
        now = monotonic()
        if cached is not None and cached[0] > now:
            return cached[1]

        lock = self._locks[int(fingerprint[:8], 16) % len(self._locks)]
        async with lock:
            cached = self._cache.get(fingerprint)
            now = monotonic()
            if cached is not None and cached[0] > now:
                return cached[1]
            raw = await self._request(token, request_id)
            claims = self._parse(raw, request_id)
            ttl = min(
                self.settings.cache_seconds,
                max(0.0, (claims.expires_at - datetime.now(UTC)).total_seconds()),
            )
            if ttl > 0:
                if len(self._cache) >= MAX_CACHE_ENTRIES:
                    self._cache = {key: value for key, value in self._cache.items() if value[0] > now}
                if len(self._cache) >= MAX_CACHE_ENTRIES:
                    self._cache.pop(next(iter(self._cache)))
                self._cache[fingerprint] = (monotonic() + ttl, claims)
            return claims

    async def _request(self, token: str, request_id: str) -> dict[str, Any]:
        settings = self.settings
        await self.start(request_id)
        session = self._session
        if session is None or session.closed or self._headers is None:
            raise BusinessGatewayError(
                "AUTH_SERVICE_UNAVAILABLE",
                "Business token validation is temporarily unavailable.",
                status=503,
                request_id=request_id,
                retryable=True,
            )

        last_error: Exception | None = None
        for attempt in range(settings.retries + 1):
            try:
                async with session.post(
                    settings.url,
                    data={"token": token, "token_type_hint": "access_token"},
                    headers=self._headers,
                    ssl=self._ssl_context,
                    allow_redirects=False,
                ) as response:
                    body = await response.content.read(MAX_RESPONSE_BYTES + 1)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise ValueError("introspection response exceeded size limit")
                    if response.status < 200 or response.status >= 300:
                        raise RuntimeError(f"introspection endpoint returned HTTP {response.status}")
                    value = json.loads(body)
                    if not isinstance(value, dict):
                        raise TypeError("introspection response must be an object")
                    return value
            except (TimeoutError, aiohttp.ClientError, json.JSONDecodeError, RuntimeError, TypeError, ValueError) as error:
                last_error = error
                if attempt < settings.retries:
                    await asyncio.sleep(min(0.05 * (2**attempt), 0.5))

        if self.telemetry is not None:
            self.telemetry.observe_failure("introspection", type(last_error).__name__ if last_error else "unknown")
        raise BusinessGatewayError(
            "AUTH_SERVICE_UNAVAILABLE",
            "Business token validation is temporarily unavailable.",
            status=503,
            request_id=request_id,
            details={"reason": type(last_error).__name__ if last_error else "unknown"},
            retryable=True,
        )

    def _transport(self, request_id: str) -> tuple[dict[str, str], ssl.SSLContext | bool | None]:
        settings = self.settings
        if not settings.url or not settings.authority:
            raise BusinessGatewayError(
                "AUTH_SERVICE_UNAVAILABLE",
                "Business token validation is not configured.",
                status=503,
                request_id=request_id,
                retryable=True,
            )
        parsed_url = urlsplit(settings.url)
        if parsed_url.scheme != "https" and parsed_url.hostname not in {"127.0.0.1", "::1", "localhost"}:
            raise BusinessGatewayError(
                "AUTH_SERVICE_UNAVAILABLE",
                "Business token validation requires HTTPS outside loopback environments.",
                status=503,
                request_id=request_id,
                retryable=True,
            )
        if settings.auth_mode not in {"basic", "mtls"}:
            raise BusinessGatewayError(
                "AUTH_SERVICE_UNAVAILABLE",
                "Business token validation is misconfigured.",
                status=503,
                request_id=request_id,
                retryable=True,
            )

        headers = {"Accept": "application/json"}
        ssl_context: ssl.SSLContext | bool | None = None
        if settings.auth_mode == "basic":
            if not settings.client_id or not settings.client_secret:
                raise BusinessGatewayError(
                    "AUTH_SERVICE_UNAVAILABLE",
                    "Business token validation is misconfigured.",
                    status=503,
                    request_id=request_id,
                    retryable=True,
                )
            credentials = base64.b64encode(f"{settings.client_id}:{settings.client_secret}".encode()).decode()
            headers["Authorization"] = f"Basic {credentials}"
        else:
            if not settings.cert_file or not settings.key_file:
                raise BusinessGatewayError(
                    "AUTH_SERVICE_UNAVAILABLE",
                    "Business token validation is misconfigured.",
                    status=503,
                    request_id=request_id,
                    retryable=True,
                )
            ssl_context = ssl.create_default_context(cafile=settings.ca_file)
            ssl_context.load_cert_chain(settings.cert_file, settings.key_file)

        return headers, ssl_context

    def _parse(self, raw: dict[str, Any], request_id: str) -> IntrospectionClaims:
        if raw.get("active") is not True:
            raise BusinessGatewayError(
                "INVALID_ACCESS_TOKEN",
                "The business access token is invalid.",
                status=401,
                request_id=request_id,
            )

        try:
            subject = _required_string(raw, "subject")
            actor = _required_string(raw, "actorSubject")
            on_behalf = _optional_string(raw, "onBehalfOfSubject")
            workspace_id = _required_string(raw, "workspaceId")
            token_use = _required_string(raw, "tokenUse")
            if token_use != "data":
                raise PermissionError("token is not valid for the data plane")
            actions_value = raw.get("actions")
            if not isinstance(actions_value, list) or not actions_value or any(not isinstance(item, str) or not _ACTION_PATTERN.fullmatch(item) for item in actions_value):
                raise ValueError("actions must be a non-empty array of action-name strings")
            actions = frozenset(actions_value)
            audience_value = raw.get("audience", raw.get("aud"))
            if isinstance(audience_value, str):
                audience = (audience_value,)
            elif isinstance(audience_value, list) and all(isinstance(item, str) for item in audience_value):
                audience = tuple(audience_value)
            else:
                raise ValueError("audience is required")
            if self.settings.audience not in audience:
                raise PermissionError("token audience does not include this service")
            expires_at = _expiration(raw.get("expiresAt", raw.get("exp")))
            if expires_at <= datetime.now(UTC):
                raise TimeoutError("token is expired")
            permission_ref = _optional_string(raw, "permissionRef")
            required_scopes = {"datasetScope", "documentScope", "chatScope", "agentScope", "memoryScope"}
            missing_scopes = required_scopes - set(raw)
            if missing_scopes:
                raise ValueError(f"required resource scopes are missing: {', '.join(sorted(missing_scopes))}")
            dataset_scope = _parse_scope(raw["datasetScope"], allow_inherit=False)
            document_scope = _parse_scope(raw["documentScope"], allow_inherit=True)
            chat_scope = _parse_scope(raw["chatScope"], allow_inherit=False)
            agent_scope = _parse_scope(raw["agentScope"], allow_inherit=False)
            memory_scope = _parse_scope(raw["memoryScope"], allow_inherit=False)
            client_id = _optional_string(raw, "clientId") or _optional_string(raw, "client_id")
            issuer = _optional_string(raw, "iss")
            if issuer is not None and issuer.rstrip("/") != self.settings.authority.rstrip("/"):
                raise PermissionError("token authority does not match this service mapping")
        except PermissionError as error:
            raise BusinessGatewayError(
                "TOKEN_NOT_ALLOWED",
                "The business access token is not valid for this service.",
                status=403,
                request_id=request_id,
            ) from error
        except TimeoutError as error:
            raise BusinessGatewayError(
                "EXPIRED_ACCESS_TOKEN",
                "The business access token has expired.",
                status=401,
                request_id=request_id,
            ) from error
        except (TypeError, ValueError) as error:
            self._invalid_contract(request_id, str(error), error)

        return IntrospectionClaims(
            authority=self.settings.authority,
            subject=subject,
            actor_subject=actor,
            on_behalf_of_subject=on_behalf,
            workspace_id=workspace_id,
            actions=actions,
            dataset_scope=dataset_scope,
            document_scope=document_scope,
            permission_ref=permission_ref,
            expires_at=expires_at,
            audience=audience,
            client_id=client_id,
            token_use="data",
            chat_scope=chat_scope,
            agent_scope=agent_scope,
            memory_scope=memory_scope,
        )

    def _invalid_contract(self, request_id: str, reason: str, cause: Exception | None = None):
        if self.telemetry is not None:
            self.telemetry.observe_failure("introspection", "invalid-contract")
        raise BusinessGatewayError(
            "AUTH_CONTEXT_INCOMPLETE",
            "The authorization server returned an incomplete business context.",
            status=503,
            request_id=request_id,
            details={"reason": reason},
            retryable=True,
        ) from cause


def _required_string(value: dict[str, Any], key: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return result.strip()


def _optional_string(value: dict[str, Any], key: str) -> str | None:
    result = value.get(key)
    if result is None:
        return None
    if not isinstance(result, str) or not result.strip():
        raise ValueError(f"{key} must be a non-empty string when present")
    return result.strip()


def _expiration(value: Any) -> datetime:
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return datetime.fromtimestamp(value, tz=UTC)
        if isinstance(value, str):
            normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
            result = datetime.fromisoformat(normalized)
            return result.replace(tzinfo=UTC) if result.tzinfo is None else result.astimezone(UTC)
    except (OverflowError, OSError, ValueError) as error:
        raise ValueError("expiresAt is invalid") from error
    raise ValueError("expiresAt is required")


def _parse_scope(value: Any, *, allow_inherit: bool) -> ResourceScope:
    if not isinstance(value, dict) or set(value) - {"mode", "ids"}:
        raise ValueError("resource scope must be a closed object")
    mode = value.get("mode")
    allowed = {"all", "ids", "none"} | ({"inherit"} if allow_inherit else set())
    if mode not in allowed:
        raise ValueError("resource scope mode is invalid")
    ids = value.get("ids", [])
    if mode == "ids":
        if not isinstance(ids, list) or not ids or len(ids) > 10_000 or any(not isinstance(item, str) or not item.strip() for item in ids):
            raise ValueError("ids scope requires a bounded non-empty string array")
        return ResourceScope("ids", frozenset(item.strip() for item in ids))
    if "ids" in value and ids:
        raise ValueError("scope ids are only valid with mode=ids")
    return ResourceScope(mode)  # type: ignore[arg-type]
