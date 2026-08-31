#!/usr/bin/env python3
"""Black-box production gate for a deployed RAGFlow Business Gateway."""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

_PATH_PARAMETER = re.compile(r"\{[^}]+\}")
_MAX_RESPONSE_BYTES = 1024 * 1024


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, _request, _file_pointer, _code, _message, _headers, _new_url):
        return None


@dataclass(frozen=True)
class Result:
    status: int
    body: bytes

    def json(self):
        return json.loads(self.body)


def run_gate(base_url: str, access_token: str, ca_file: str | None = None) -> None:
    base_url = base_url.rstrip("/")
    parsed = urlsplit(base_url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise AssertionError("Gateway base URL must be a credential-free service root without a path, query, or fragment")
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise AssertionError("Production Gateway service root must use HTTPS")
    context = ssl.create_default_context(cafile=ca_file) if parsed.scheme == "https" else None

    health = _request(base_url, "/api/v1/health", context=context)
    _expect(health, 200, "liveness")
    ready = _request(base_url, "/api/v1/ready", context=context)
    _expect(ready, 200, "readiness")
    if ready.json().get("status") != "ready":
        raise AssertionError("Gateway readiness response is not ready")

    manifest = _request(base_url, "/api/v1/capabilities", context=context)
    _expect(manifest, 200, "capability manifest")
    operations = manifest.json().get("operations")
    if not isinstance(operations, list) or not operations:
        raise AssertionError("Gateway capability manifest has no operations")

    for capability in operations:
        path = _PATH_PARAMETER.sub("deployment-probe-resource", str(capability["path"]))
        result = _request(base_url, f"/api/v1{path}", method=str(capability["method"]), context=context)
        _expect(result, 401, f"unauthenticated {capability['operation']}")
        error = result.json().get("error", {})
        if error.get("code") != "MISSING_ACCESS_TOKEN" or not error.get("requestId"):
            raise AssertionError(f"{capability['operation']} did not return the canonical 401 envelope")

    original_api = _request(base_url, "/api/v1/user/info", context=context)
    _expect(original_api, 404, "original RAGFlow API isolation")
    metrics = _request(base_url, "/api/v1/_metrics", context=context)
    _expect(metrics, 404, "public metrics isolation")

    authorization = _request(
        base_url,
        "/api/v1/gateway-context",
        headers={"Authorization": f"Bearer {access_token}"},
        context=context,
    )
    _expect(authorization, 200, "business authorization context")
    data = authorization.json().get("data", {})
    required = {"datasetScope", "documentScope", "chatScope", "agentScope", "memoryScope"}
    if not required.issubset(data):
        raise AssertionError(f"Business authorization context is missing scopes: {sorted(required - set(data))}")
    for name in required:
        scope = data[name]
        allowed_modes = {"all", "ids", "none", "inherit"} if name == "documentScope" else {"all", "ids", "none"}
        if not isinstance(scope, dict) or scope.get("mode") not in allowed_modes:
            raise AssertionError(f"Business authorization context contains an invalid {name}")
    if {"tenantId", "executionUserId", "workspaceBindingId", "tokenFingerprint"} & set(data):
        raise AssertionError("Business authorization context exposed a server-local execution field")


def _request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    context: ssl.SSLContext | None,
) -> Result:
    method = method.upper()
    body = b"{}" if method in {"POST", "PUT", "PATCH"} else None
    request_headers = {"Accept": "application/json", **(headers or {})}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    request = Request(f"{base_url}{path}", data=body, headers=request_headers, method=method)
    handlers = [_NoRedirect()]
    if context is not None:
        handlers.append(HTTPSHandler(context=context))
    opener = build_opener(*handlers)
    try:
        with opener.open(request, timeout=15) as response:
            return Result(response.status, _bounded_body(response))
    except HTTPError as error:
        return Result(error.code, _bounded_body(error))


def _expect(result: Result, expected: int, label: str) -> None:
    if result.status != expected:
        raise AssertionError(f"{label}: expected HTTP {expected}, got {result.status}")


def _bounded_body(response) -> bytes:
    body = response.read(_MAX_RESPONSE_BYTES + 1)
    if len(body) > _MAX_RESPONSE_BYTES:
        raise AssertionError("Gateway probe response exceeded the deployment gate limit")
    return body


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.getenv("NOMIX_BG_TEST_BASE_URL"))
    parser.add_argument("--access-token", default=os.getenv("NOMIX_BG_TEST_ACCESS_TOKEN"))
    parser.add_argument("--ca-file", default=os.getenv("NOMIX_BG_TEST_CA_FILE"))
    args = parser.parse_args()
    if not args.base_url or not args.access_token:
        parser.error("--base-url and --access-token (or matching NOMIX_BG_TEST_* variables) are required")
    if args.ca_file and not Path(args.ca_file).is_file():
        parser.error("--ca-file does not exist")
    try:
        run_gate(args.base_url, args.access_token, args.ca_file)
    except AssertionError as error:
        print(f"Business Gateway production gate failed: {error}", file=sys.stderr)
        return 1
    print("Business Gateway production gate passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
