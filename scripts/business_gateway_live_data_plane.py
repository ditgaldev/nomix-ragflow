#!/usr/bin/env python3
"""Destructive, self-cleaning black-box gate for a deployed Business Gateway.

The gate uses two environment-protected business identities and only removes
resources whose random names and IDs were created by this invocation.
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

_MAX_JSON_BYTES = 4 * 1024 * 1024
_MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024
_REQUIRED_ACTIONS = frozenset(
    {
        "authorization:read",
        "knowledge:retrieve",
        "dataset:read",
        "dataset:create",
        "dataset:update",
        "dataset:delete",
        "document:read",
        "document:upload",
        "document:update",
        "document:delete",
        "document:parse",
    }
)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, _request, _file_pointer, _code, _message, _headers, _new_url):
        return None


@dataclass(frozen=True)
class Result:
    status: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body)


class GatewayClient:
    """Bounded standard-library client that never logs or serializes its token."""

    def __init__(self, base_url: str, access_token: str, *, ca_file: str | None = None, timeout_seconds: float = 30) -> None:
        self.base_url, self.context = _validated_service_root(base_url, ca_file)
        self._access_token = access_token
        self._timeout_seconds = timeout_seconds

    def request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: Any | None = None,
        body: bytes | None = None,
        content_type: str | None = None,
        headers: dict[str, str] | None = None,
        max_response_bytes: int = _MAX_JSON_BYTES,
    ) -> Result:
        if not path.startswith("/") or ".." in path or "?" in path or "#" in path:
            raise AssertionError("Gateway probe path must be an absolute path without traversal, query, or fragment")
        if json_body is not None and body is not None:
            raise AssertionError("Gateway probe request cannot contain both JSON and a pre-encoded body")
        if any(name.lower() in {"authorization", "content-type"} for name in (headers or {})):
            raise AssertionError("Gateway probe request options cannot override Authorization or Content-Type")
        encoded_query = _encoded_query(query or {})
        url = f"{self.base_url}/api/v1{path}{encoded_query}"
        request_headers = {"Accept": "application/json", "Authorization": f"Bearer {self._access_token}", **(headers or {})}
        if json_body is not None:
            body = json.dumps(json_body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            content_type = "application/json"
        if content_type is not None:
            request_headers["Content-Type"] = content_type
        request = Request(url, data=body, headers=request_headers, method=method.upper())
        handlers = [_NoRedirect()]
        if self.context is not None:
            handlers.append(HTTPSHandler(context=self.context))
        opener = build_opener(*handlers)
        try:
            with opener.open(request, timeout=self._timeout_seconds) as response:
                return Result(response.status, _headers(response.headers), _bounded_body(response, max_response_bytes))
        except HTTPError as error:
            return Result(error.code, _headers(error.headers), _bounded_body(error, max_response_bytes))


@dataclass
class WorkspaceRun:
    label: str
    client: GatewayClient
    context: dict[str, Any] | None = None
    dataset_id: str | None = None
    dataset_name: str | None = None
    dataset_version: int | None = None
    document_id: str | None = None
    document_name: str | None = None
    document_version: int | None = None
    document_content: bytes | None = None


@dataclass
class GateReport:
    started_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    status: str = "running"
    checks: list[dict[str, Any]] = field(default_factory=list)
    cleanup: list[dict[str, Any]] = field(default_factory=list)
    failure: dict[str, str] | None = None

    def checked(self, name: str, started: float) -> None:
        self.checks.append({"name": name, "status": "passed", "durationMs": round((time.monotonic() - started) * 1000)})

    def to_dict(self) -> dict[str, Any]:
        return {
            "standardVersion": "v1",
            "service": "nomix-ragflow",
            "test": "business-gateway-live-data-plane",
            "startedAt": self.started_at,
            "finishedAt": datetime.now(UTC).isoformat(),
            "status": self.status,
            "checks": self.checks,
            "cleanup": self.cleanup,
            **({"failure": self.failure} if self.failure is not None else {}),
        }


def run_gate(
    base_url: str,
    access_token_a: str,
    access_token_b: str,
    *,
    ca_file: str | None = None,
    allow_writes: bool = False,
    parse_timeout_seconds: float = 300,
    poll_interval_seconds: float = 2,
    request_timeout_seconds: float = 30,
    report_file: str | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Run a two-workspace real-dependency scenario and return a redacted report."""

    if not allow_writes:
        raise AssertionError("The live data-plane gate requires explicit allow_writes=true")
    if not access_token_a or not access_token_b or access_token_a == access_token_b:
        raise AssertionError("Two distinct non-empty business access tokens are required")
    if parse_timeout_seconds <= 0 or poll_interval_seconds <= 0 or request_timeout_seconds <= 0:
        raise AssertionError("All live data-plane timeouts must be positive")

    suffix = uuid.uuid4().hex[:12]
    report = GateReport()
    runs = [
        WorkspaceRun("a", GatewayClient(base_url, access_token_a, ca_file=ca_file, timeout_seconds=request_timeout_seconds)),
        WorkspaceRun("b", GatewayClient(base_url, access_token_b, ca_file=ca_file, timeout_seconds=request_timeout_seconds)),
    ]
    failure: BaseException | None = None
    try:
        _run_scenario(runs, suffix, report, parse_timeout_seconds, poll_interval_seconds, sleep)
        report.status = "passed"
    except BaseException as error:  # noqa: BLE001 - report and cleanup must cover every failed assertion/network error
        failure = error
        report.status = "failed"
        report.failure = {"type": type(error).__name__, "message": _safe_message(error)}
    finally:
        cleanup_failures = _cleanup(runs, suffix, report)
        if cleanup_failures and failure is None:
            failure = AssertionError("The live data-plane checks passed but one or more owned resources could not be cleaned up")
            report.status = "failed"
            report.failure = {"type": type(failure).__name__, "message": str(failure)}
        if report_file:
            _write_report(report_file, report.to_dict())
    if failure is not None:
        raise failure
    return report.to_dict()


def _run_scenario(
    runs: list[WorkspaceRun],
    suffix: str,
    report: GateReport,
    parse_timeout_seconds: float,
    poll_interval_seconds: float,
    sleep: Callable[[float], None],
) -> None:
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=2) as executor:
        contexts = list(executor.map(_authorization_context, runs))
    for run, context in zip(runs, contexts, strict=True):
        run.context = context
        _validate_test_context(run)
    if runs[0].context["workspaceId"] == runs[1].context["workspaceId"]:
        raise AssertionError("The two live tokens resolved to the same workspace")
    if runs[0].context["subject"] == runs[1].context["subject"]:
        raise AssertionError("The two live tokens resolved to the same subject")
    report.checked("concurrent authorization contexts are isolated", started)

    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=2) as executor:
        datasets = list(executor.map(lambda run: _create_dataset(run, suffix), runs))
    for run, dataset in zip(runs, datasets, strict=True):
        run.dataset_id = _required_string(dataset, "id", f"workspace {run.label} dataset")
        run.dataset_name = _required_string(dataset, "name", f"workspace {run.label} dataset")
        run.dataset_version = _required_version(dataset, f"workspace {run.label} dataset")
    report.checked("concurrent tenant-bound dataset creation", started)

    started = time.monotonic()
    _verify_create_replay_and_conflict(runs[0], suffix)
    report.checked("idempotency replay and request conflict", started)

    started = time.monotonic()
    forged_context = _expect_success(
        runs[0].client.request("GET", "/gateway-context", headers={"X-Tenant-Id": "forged", "X-Nomix-Actions": "dataset:delete"}),
        200,
        "ingress-cleared forged authorization headers",
    )
    for name in ("workspaceId", "subject", "actions", "datasetScope", "documentScope"):
        if forged_context.get(name) != runs[0].context.get(name):
            raise AssertionError(f"A forged authorization header changed the verified {name}")
    _expect_error(runs[1].client.request("GET", f"/datasets/{runs[0].dataset_id}"), 404, "RESOURCE_NOT_FOUND", "workspace b reading workspace a dataset")
    _expect_error(runs[0].client.request("GET", f"/datasets/{runs[1].dataset_id}"), 404, "RESOURCE_NOT_FOUND", "workspace a reading workspace b dataset")
    _verify_cross_workspace_dataset_mutations(runs, suffix)
    report.checked("forged context and cross-workspace dataset access fail closed", started)

    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=2) as executor:
        documents = list(executor.map(lambda run: _upload_document(run, suffix), runs))
    for run, document in zip(runs, documents, strict=True):
        run.document_id = _required_string(document, "id", f"workspace {run.label} document")
        run.document_name = _required_string(document, "name", f"workspace {run.label} document")
        run.document_version = _required_version(document, f"workspace {run.label} document")
    report.checked("real object-storage document upload", started)

    started = time.monotonic()
    _expect_error(
        runs[1].client.request("GET", f"/datasets/{runs[0].dataset_id}/documents/{runs[0].document_id}"),
        404,
        "RESOURCE_NOT_FOUND",
        "workspace b reading workspace a document",
    )
    _expect_error(
        runs[0].client.request("GET", f"/datasets/{runs[1].dataset_id}/documents/{runs[1].document_id}"),
        404,
        "RESOURCE_NOT_FOUND",
        "workspace a reading workspace b document",
    )
    _verify_cross_workspace_document_mutations(runs, suffix)
    for run in runs:
        downloaded = run.client.request(
            "GET",
            f"/datasets/{run.dataset_id}/documents/{run.document_id}/content",
            max_response_bytes=_MAX_DOWNLOAD_BYTES,
        )
        if downloaded.status != 200 or downloaded.body != run.document_content:
            raise AssertionError(f"workspace {run.label} object-storage download did not match its uploaded bytes")
    report.checked("document scope and object-storage round trip", started)

    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(lambda run: _start_parse(run, suffix), runs))
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(
            executor.map(
                lambda run: _wait_for_parse(run, parse_timeout_seconds, poll_interval_seconds, sleep),
                runs,
            )
        )
    report.checked("real document-engine parsing", started)

    started = time.monotonic()
    for run in runs:
        _verify_retrieval(run)
    _expect_error(
        runs[0].client.request(
            "POST",
            "/retrieval",
            json_body={"question": "cross workspace probe", "datasetIds": [runs[1].dataset_id], "limit": 5},
        ),
        404,
        "RESOURCE_NOT_FOUND",
        "workspace a explicitly retrieving workspace b dataset",
    )
    _verify_server_selected_scope(runs[0], forbidden=runs[1])
    _verify_server_selected_scope(runs[1], forbidden=runs[0])
    report.checked("explicit and server-selected retrieval scopes are isolated", started)


def _authorization_context(run: WorkspaceRun) -> dict[str, Any]:
    return _expect_success(run.client.request("GET", "/gateway-context"), 200, f"workspace {run.label} authorization context")


def _validate_test_context(run: WorkspaceRun) -> None:
    assert run.context is not None
    missing = sorted(_REQUIRED_ACTIONS - set(run.context.get("actions") or []))
    if missing:
        raise AssertionError(f"workspace {run.label} live token is missing required actions: {', '.join(missing)}")
    if (run.context.get("datasetScope") or {}).get("mode") != "all":
        raise AssertionError(f"workspace {run.label} live token requires datasetScope.mode=all for owned test-resource creation")
    if (run.context.get("documentScope") or {}).get("mode") not in {"all", "inherit"}:
        raise AssertionError(f"workspace {run.label} live token requires documentScope.mode=all or inherit")
    _required_string(run.context, "workspaceId", f"workspace {run.label} authorization context")
    _required_string(run.context, "subject", f"workspace {run.label} authorization context")


def _create_dataset(run: WorkspaceRun, suffix: str) -> dict[str, Any]:
    run.dataset_name = f"nomix-bg-e2e-{suffix}-{run.label}"
    result = run.client.request(
        "POST",
        "/datasets",
        json_body={"name": run.dataset_name, "description": "Owned by the self-cleaning Nomix Business Gateway live gate."},
        headers={"Idempotency-Key": _dataset_key(suffix, run.label)},
    )
    return _expect_success(result, 201, f"workspace {run.label} dataset creation")


def _verify_create_replay_and_conflict(run: WorkspaceRun, suffix: str) -> None:
    payload = {"name": run.dataset_name, "description": "Owned by the self-cleaning Nomix Business Gateway live gate."}
    replay = run.client.request(
        "POST",
        "/datasets",
        json_body=payload,
        headers={"Idempotency-Key": _dataset_key(suffix, run.label)},
    )
    replay_data = _expect_success(replay, 201, "dataset idempotency replay")
    if replay.headers.get("x-idempotent-replay") != "true" or replay_data.get("id") != run.dataset_id:
        raise AssertionError("Dataset idempotency replay did not return the original resource")
    conflict = run.client.request(
        "POST",
        "/datasets",
        json_body={**payload, "description": "conflicting request body"},
        headers={"Idempotency-Key": _dataset_key(suffix, run.label)},
    )
    _expect_error(conflict, 409, "IDEMPOTENCY_CONFLICT", "dataset idempotency conflict")


def _verify_cross_workspace_dataset_mutations(runs: list[WorkspaceRun], suffix: str) -> None:
    workspace_a, workspace_b = runs
    _expect_error(
        workspace_a.client.request(
            "PATCH",
            f"/datasets/{workspace_b.dataset_id}",
            json_body={"description": "cross-workspace update must fail"},
            headers={
                "If-Match": str(workspace_b.dataset_version),
                "Idempotency-Key": f"nomix-bg-e2e-cross-dataset-update-{suffix}",
            },
        ),
        404,
        "RESOURCE_NOT_FOUND",
        "workspace a updating workspace b dataset",
    )
    _expect_error(
        workspace_b.client.request(
            "DELETE",
            f"/datasets/{workspace_a.dataset_id}",
            json_body={},
            headers={
                "If-Match": str(workspace_a.dataset_version),
                "Idempotency-Key": f"nomix-bg-e2e-cross-dataset-delete-{suffix}",
            },
        ),
        404,
        "RESOURCE_NOT_FOUND",
        "workspace b deleting workspace a dataset",
    )
    for run in runs:
        _expect_success(
            run.client.request("GET", f"/datasets/{run.dataset_id}"),
            200,
            f"workspace {run.label} dataset survived cross-workspace mutations",
        )


def _upload_document(run: WorkspaceRun, suffix: str) -> dict[str, Any]:
    run.document_name = f"nomix-bg-e2e-{suffix}-{run.label}.txt"
    marker = f"nomix gateway isolation marker {suffix} workspace {run.label}"
    run.document_content = (f"{marker}\nThis bounded document proves upload, object storage, parsing, retrieval, and tenant isolation.\n").encode()
    body, content_type = _multipart_file("file", run.document_name, run.document_content, "text/plain; charset=utf-8")
    result = run.client.request(
        "POST",
        f"/datasets/{run.dataset_id}/documents",
        body=body,
        content_type=content_type,
        headers={"Idempotency-Key": f"nomix-bg-e2e-upload-{suffix}-{run.label}"},
    )
    documents = _expect_success(result, 201, f"workspace {run.label} document upload")
    if not isinstance(documents, list) or len(documents) != 1 or not isinstance(documents[0], dict):
        raise AssertionError(f"workspace {run.label} upload did not return exactly one document")
    return documents[0]


def _start_parse(run: WorkspaceRun, suffix: str) -> None:
    _expect_success(
        run.client.request(
            "POST",
            f"/datasets/{run.dataset_id}/documents:parse",
            json_body={"documentIds": [run.document_id]},
            headers={"Idempotency-Key": f"nomix-bg-e2e-parse-{suffix}-{run.label}"},
        ),
        202,
        f"workspace {run.label} parse start",
    )


def _verify_cross_workspace_document_mutations(runs: list[WorkspaceRun], suffix: str) -> None:
    workspace_a, workspace_b = runs
    _expect_error(
        workspace_a.client.request(
            "PATCH",
            f"/datasets/{workspace_b.dataset_id}/documents/{workspace_b.document_id}",
            json_body={"name": "cross-workspace-update-must-fail.txt"},
            headers={
                "If-Match": str(workspace_b.document_version),
                "Idempotency-Key": f"nomix-bg-e2e-cross-document-update-{suffix}",
            },
        ),
        404,
        "RESOURCE_NOT_FOUND",
        "workspace a updating workspace b document",
    )
    _expect_error(
        workspace_b.client.request(
            "DELETE",
            f"/datasets/{workspace_a.dataset_id}/documents/{workspace_a.document_id}",
            json_body={},
            headers={
                "If-Match": str(workspace_a.document_version),
                "Idempotency-Key": f"nomix-bg-e2e-cross-document-delete-{suffix}",
            },
        ),
        404,
        "RESOURCE_NOT_FOUND",
        "workspace b deleting workspace a document",
    )
    for run in runs:
        _expect_success(
            run.client.request("GET", f"/datasets/{run.dataset_id}/documents/{run.document_id}"),
            200,
            f"workspace {run.label} document survived cross-workspace mutations",
        )


def _wait_for_parse(run: WorkspaceRun, timeout_seconds: float, interval_seconds: float, sleep: Callable[[float], None]) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        document = _expect_success(
            run.client.request("GET", f"/datasets/{run.dataset_id}/documents/{run.document_id}"),
            200,
            f"workspace {run.label} parse status",
        )
        state = str(document.get("run") or "").upper()
        if state in {"2", "4", "CANCEL", "FAIL"}:
            raise AssertionError(f"workspace {run.label} document parsing reached terminal state {state}")
        if state in {"3", "DONE"} or _parse_progress(document.get("progress")) >= 1:
            return
        sleep(min(interval_seconds, max(deadline - time.monotonic(), 0)))
    raise AssertionError(f"workspace {run.label} document parsing did not complete before the live-gate deadline")


def _verify_retrieval(run: WorkspaceRun) -> None:
    marker = run.document_content.decode("utf-8").splitlines()[0]
    data = _expect_success(
        run.client.request(
            "POST",
            "/retrieval",
            json_body={"question": marker, "datasetIds": [run.dataset_id], "limit": 10, "similarityThreshold": 0},
        ),
        200,
        f"workspace {run.label} explicit retrieval",
    )
    chunks = data.get("chunks") if isinstance(data, dict) else None
    if not isinstance(chunks, list) or not chunks:
        raise AssertionError(f"workspace {run.label} retrieval returned no chunks for its parsed marker")
    if not any(chunk.get("documentId") == run.document_id for chunk in chunks if isinstance(chunk, dict)):
        raise AssertionError(f"workspace {run.label} retrieval did not return its owned document")


def _verify_server_selected_scope(run: WorkspaceRun, *, forbidden: WorkspaceRun) -> None:
    marker = run.document_content.decode("utf-8").splitlines()[0]
    data = _expect_success(
        run.client.request("POST", "/retrieval", json_body={"question": marker, "limit": 10, "similarityThreshold": 0}),
        200,
        f"workspace {run.label} server-selected retrieval",
    )
    chunks = data.get("chunks") if isinstance(data, dict) else None
    if not isinstance(chunks, list):
        raise TypeError(f"workspace {run.label} server-selected retrieval returned an invalid chunk list")
    for chunk in chunks:
        if isinstance(chunk, dict) and (chunk.get("datasetId") == forbidden.dataset_id or chunk.get("documentId") == forbidden.document_id):
            raise AssertionError(f"workspace {run.label} server-selected retrieval leaked the other workspace")


def _cleanup(runs: list[WorkspaceRun], suffix: str, report: GateReport) -> list[str]:
    failures: list[str] = []
    for run in reversed(runs):
        if run.dataset_id is None:
            continue
        try:
            current = run.client.request("GET", f"/datasets/{run.dataset_id}")
            if current.status == 404:
                report.cleanup.append({"workspace": run.label, "resource": "dataset", "status": "already-absent"})
                continue
            data = _expect_success(current, 200, f"workspace {run.label} cleanup dataset read")
            version = data.get("version")
            if not isinstance(version, int) or version < 1:
                raise AssertionError("Cleanup dataset did not expose a positive numeric version")
            _expect_success(
                run.client.request(
                    "DELETE",
                    f"/datasets/{run.dataset_id}",
                    json_body={},
                    headers={
                        "If-Match": str(version),
                        "Idempotency-Key": f"nomix-bg-e2e-cleanup-{suffix}-{run.label}",
                    },
                ),
                200,
                f"workspace {run.label} cleanup dataset delete",
            )
            report.cleanup.append({"workspace": run.label, "resource": "dataset", "status": "deleted"})
        except BaseException as error:  # noqa: BLE001 - all cleanup failures must be reported together
            failures.append(f"workspace {run.label}: {_safe_message(error)}")
            report.cleanup.append({"workspace": run.label, "resource": "dataset", "status": "failed", "errorType": type(error).__name__})
    return failures


def _expect_success(result: Result, expected_status: int, label: str) -> Any:
    if result.status != expected_status:
        raise AssertionError(f"{label}: expected HTTP {expected_status}, got {result.status} ({_error_code(result)})")
    try:
        envelope = result.json()
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AssertionError(f"{label}: response was not valid JSON") from error
    if not isinstance(envelope, dict) or set(envelope) != {"data", "meta"} or not isinstance(envelope["meta"], dict):
        raise AssertionError(f"{label}: response was not a canonical success envelope")
    if not isinstance(envelope["meta"].get("requestId"), str) or not envelope["meta"]["requestId"]:
        raise AssertionError(f"{label}: response had no requestId")
    return envelope["data"]


def _expect_error(result: Result, expected_status: int, expected_code: str, label: str) -> None:
    if result.status != expected_status:
        raise AssertionError(f"{label}: expected HTTP {expected_status}, got {result.status} ({_error_code(result)})")
    try:
        envelope = result.json()
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AssertionError(f"{label}: error response was not valid JSON") from error
    error = envelope.get("error") if isinstance(envelope, dict) else None
    if not isinstance(error, dict) or error.get("code") != expected_code or not error.get("requestId"):
        raise AssertionError(f"{label}: response was not the expected canonical {expected_code} error")


def _error_code(result: Result) -> str:
    try:
        value = result.json()
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "non-json-response"
    error = value.get("error") if isinstance(value, dict) else None
    return str(error.get("code", "unknown-error")) if isinstance(error, dict) else "unknown-error"


def _required_string(value: dict[str, Any], key: str, label: str) -> str:
    member = value.get(key)
    if not isinstance(member, str) or not member:
        raise AssertionError(f"{label} did not contain a non-empty {key}")
    return member


def _required_version(value: dict[str, Any], label: str) -> int:
    version = value.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise AssertionError(f"{label} did not contain a positive numeric version")
    return version


def _parse_progress(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


def _dataset_key(suffix: str, label: str) -> str:
    return f"nomix-bg-e2e-dataset-{suffix}-{label}"


def _multipart_file(field: str, name: str, content: bytes, content_type: str) -> tuple[bytes, str]:
    if not field or not name or any(character in field or character in name for character in '\r\n\0/\\"'):
        raise AssertionError("Live-gate multipart names must be plain non-empty names")
    boundary = f"nomix-bg-{uuid.uuid4().hex}"
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{name}"\r\nContent-Type: {content_type}\r\n\r\n').encode()
    return head + content + f"\r\n--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def _encoded_query(query: dict[str, Any]) -> str:
    values: list[tuple[str, str]] = []
    for key, value in query.items():
        if value is None:
            continue
        members = value if isinstance(value, (list, tuple)) else [value]
        values.extend((key, str(member)) for member in members)
    return f"?{urlencode(values)}" if values else ""


def _validated_service_root(base_url: str, ca_file: str | None) -> tuple[str, ssl.SSLContext | None]:
    normalized = base_url.rstrip("/")
    parsed = urlsplit(normalized)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise AssertionError("Gateway base URL must be a credential-free service root without a path, query, or fragment")
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise AssertionError("Gateway base URL must use HTTP or HTTPS and include a host")
    if parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise AssertionError("Live Business Gateway service root must use HTTPS")
    return normalized, ssl.create_default_context(cafile=ca_file) if parsed.scheme == "https" else None


def _headers(headers: Any) -> dict[str, str]:
    return {str(name).lower(): str(value) for name, value in headers.items()}


def _bounded_body(response: Any, max_bytes: int) -> bytes:
    body = response.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise AssertionError("Gateway live-gate response exceeded its bounded response limit")
    return body


def _safe_message(error: BaseException) -> str:
    message = " ".join(str(error).split())
    return message[:500] or type(error).__name__


def _write_report(path: str, value: dict[str, Any]) -> None:
    target = Path(path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _env_true(name: str) -> bool:
    return os.getenv(name, "").strip().lower() == "true"


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name, "").strip()
    return float(value) if value else default


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.getenv("NOMIX_BG_TEST_BASE_URL"))
    parser.add_argument("--access-token-a", default=os.getenv("NOMIX_BG_TEST_ACCESS_TOKEN_A"))
    parser.add_argument("--access-token-b", default=os.getenv("NOMIX_BG_TEST_ACCESS_TOKEN_B"))
    parser.add_argument("--ca-file", default=os.getenv("NOMIX_BG_TEST_CA_FILE"))
    parser.add_argument("--parse-timeout-seconds", type=float, default=_env_float("NOMIX_BG_TEST_PARSE_TIMEOUT_SECONDS", 300))
    parser.add_argument("--poll-interval-seconds", type=float, default=_env_float("NOMIX_BG_TEST_POLL_INTERVAL_SECONDS", 2))
    parser.add_argument("--request-timeout-seconds", type=float, default=_env_float("NOMIX_BG_TEST_REQUEST_TIMEOUT_SECONDS", 30))
    parser.add_argument("--report-file", default=os.getenv("NOMIX_BG_TEST_REPORT_FILE"))
    parser.add_argument("--allow-writes", action="store_true", default=_env_true("NOMIX_BG_LIVE_ALLOW_WRITES"))
    args = parser.parse_args()
    if not args.base_url or not args.access_token_a or not args.access_token_b:
        parser.error("--base-url and two access tokens (or matching NOMIX_BG_TEST_* variables) are required")
    if args.ca_file and not Path(args.ca_file).is_file():
        parser.error("--ca-file does not exist")
    try:
        run_gate(
            args.base_url,
            args.access_token_a,
            args.access_token_b,
            ca_file=args.ca_file,
            allow_writes=args.allow_writes,
            parse_timeout_seconds=args.parse_timeout_seconds,
            poll_interval_seconds=args.poll_interval_seconds,
            request_timeout_seconds=args.request_timeout_seconds,
            report_file=args.report_file,
        )
    except BaseException as error:  # noqa: BLE001 - command boundary returns one redacted failure
        print(f"Business Gateway live data-plane gate failed: {_safe_message(error)}", file=sys.stderr)
        return 1
    print("Business Gateway live data-plane gate passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
