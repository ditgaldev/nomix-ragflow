#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import json
import re
from typing import ClassVar

import pytest

from scripts import business_gateway_live_data_plane as gate


class FakeGatewayClient:
    datasets: ClassVar[dict[str, dict]] = {}
    documents: ClassVar[dict[str, dict]] = {}
    idempotency: ClassVar[dict[tuple[str, str], tuple[str, dict]]] = {}

    def __init__(self, _base_url, access_token, **_kwargs):
        self.owner = {"token-a": "a", "token-b": "b"}[access_token]

    @classmethod
    def reset(cls):
        cls.datasets = {}
        cls.documents = {}
        cls.idempotency = {}

    def request(self, method, path, *, json_body=None, body=None, headers=None, **_kwargs):
        headers = headers or {}
        if path == "/gateway-context":
            return self._success(
                200,
                {
                    "subject": f"subject-{self.owner}",
                    "actorSubject": f"subject-{self.owner}",
                    "onBehalfOfSubject": None,
                    "workspaceId": f"workspace-{self.owner}",
                    "actions": sorted(gate._REQUIRED_ACTIONS),
                    "datasetScope": {"mode": "all"},
                    "documentScope": {"mode": "inherit"},
                    "chatScope": {"mode": "none"},
                    "agentScope": {"mode": "none"},
                    "memoryScope": {"mode": "none"},
                    "permissionRef": None,
                    "authenticationType": "token-introspection",
                    "requestId": f"context-{self.owner}",
                    "tokenUse": "data",
                    "audience": ["nomix-ragflow-data"],
                    "expiresAt": "2030-01-01T00:00:00Z",
                    "clientId": "test",
                },
            )
        if method == "POST" and path == "/datasets":
            key = headers["Idempotency-Key"]
            fingerprint = json.dumps(json_body, sort_keys=True)
            existing = self.idempotency.get((self.owner, key))
            if existing is not None:
                previous_fingerprint, dataset = existing
                if previous_fingerprint != fingerprint:
                    return self._error(409, "IDEMPOTENCY_CONFLICT")
                return self._success(201, dataset, {"x-idempotent-replay": "true"})
            dataset = {"id": f"dataset-{self.owner}", "name": json_body["name"], "version": 1}
            self.datasets[dataset["id"]] = {**dataset, "owner": self.owner}
            self.idempotency[(self.owner, key)] = (fingerprint, dataset)
            return self._success(201, dataset)
        if method == "POST" and path == "/retrieval":
            requested = json_body.get("datasetIds") or []
            if any(self.datasets.get(dataset_id, {}).get("owner") != self.owner for dataset_id in requested):
                return self._error(404, "RESOURCE_NOT_FOUND")
            chunks = [
                {"id": f"chunk-{document_id}", "content": document["content"].decode(), "datasetId": document["datasetId"], "documentId": document_id}
                for document_id, document in self.documents.items()
                if document["owner"] == self.owner and (not requested or document["datasetId"] in requested)
            ]
            return self._success(200, {"chunks": chunks, "total": len(chunks), "docAggs": {}})

        dataset_match = re.fullmatch(r"/datasets/([^/]+)", path)
        if dataset_match:
            dataset_id = dataset_match.group(1)
            dataset = self.datasets.get(dataset_id)
            if dataset is None or dataset["owner"] != self.owner:
                return self._error(404, "RESOURCE_NOT_FOUND")
            if method == "GET":
                return self._success(200, {key: value for key, value in dataset.items() if key != "owner"})
            if method == "DELETE":
                del self.datasets[dataset_id]
                for document_id in [key for key, value in self.documents.items() if value["datasetId"] == dataset_id]:
                    del self.documents[document_id]
                return self._success(200, {"successCount": 1})

        upload_match = re.fullmatch(r"/datasets/([^/]+)/documents", path)
        if upload_match and method == "POST":
            dataset_id = upload_match.group(1)
            dataset = self.datasets.get(dataset_id)
            if dataset is None or dataset["owner"] != self.owner:
                return self._error(404, "RESOURCE_NOT_FOUND")
            header, content = body.split(b"\r\n\r\n", 1)
            content = content.rsplit(b"\r\n--", 1)[0]
            name_match = re.search(rb'filename="([^"]+)"', header)
            assert name_match is not None
            document_id = f"document-{self.owner}"
            document = {
                "id": document_id,
                "name": name_match.group(1).decode(),
                "version": 1,
                "datasetId": dataset_id,
                "run": "0",
                "progress": 0,
                "owner": self.owner,
                "content": content,
            }
            self.documents[document_id] = document
            return self._success(201, [{key: value for key, value in document.items() if key not in {"owner", "content"}}])

        parse_match = re.fullmatch(r"/datasets/([^/]+)/documents:parse", path)
        if parse_match and method == "POST":
            for document_id in json_body["documentIds"]:
                document = self.documents.get(document_id)
                if document is None or document["owner"] != self.owner:
                    return self._error(404, "RESOURCE_NOT_FOUND")
                document.update(run="3", progress=1)
            return self._success(202, {"successCount": len(json_body["documentIds"])})

        content_match = re.fullmatch(r"/datasets/([^/]+)/documents/([^/]+)/content", path)
        if content_match and method == "GET":
            document = self.documents.get(content_match.group(2))
            if document is None or document["owner"] != self.owner or document["datasetId"] != content_match.group(1):
                return self._error(404, "RESOURCE_NOT_FOUND")
            return gate.Result(200, {"content-type": "application/octet-stream"}, document["content"])

        document_match = re.fullmatch(r"/datasets/([^/]+)/documents/([^/]+)", path)
        if document_match:
            document = self.documents.get(document_match.group(2))
            if document is None or document["owner"] != self.owner or document["datasetId"] != document_match.group(1):
                return self._error(404, "RESOURCE_NOT_FOUND")
            if method == "GET":
                return self._success(200, {key: value for key, value in document.items() if key not in {"owner", "content"}})
        raise AssertionError(f"Unexpected fake Gateway request: {method} {path}")

    def _success(self, status, data, headers=None):
        return gate.Result(
            status,
            {"content-type": "application/json", **(headers or {})},
            json.dumps({"data": data, "meta": {"requestId": f"request-{self.owner}"}}).encode(),
        )

    def _error(self, status, code):
        return gate.Result(
            status,
            {"content-type": "application/json"},
            json.dumps({"error": {"code": code, "message": "denied", "requestId": f"request-{self.owner}", "retryable": False}}).encode(),
        )


@pytest.mark.p1
def test_live_data_plane_gate_exercises_two_workspaces_and_cleans_owned_resources(monkeypatch, tmp_path):
    FakeGatewayClient.reset()
    monkeypatch.setattr(gate, "GatewayClient", FakeGatewayClient)
    report_file = tmp_path / "live-report.json"

    report = gate.run_gate(
        "https://gateway.example.com",
        "token-a",
        "token-b",
        allow_writes=True,
        parse_timeout_seconds=1,
        poll_interval_seconds=0.01,
        request_timeout_seconds=1,
        report_file=str(report_file),
        sleep=lambda _seconds: None,
    )

    assert report["status"] == "passed"
    assert {check["name"] for check in report["checks"]} == {
        "concurrent authorization contexts are isolated",
        "concurrent tenant-bound dataset creation",
        "idempotency replay and request conflict",
        "forged context and cross-workspace dataset access fail closed",
        "real object-storage document upload",
        "document scope and object-storage round trip",
        "real document-engine parsing",
        "explicit and server-selected retrieval scopes are isolated",
    }
    assert {entry["status"] for entry in report["cleanup"]} == {"deleted"}
    assert FakeGatewayClient.datasets == {}
    assert FakeGatewayClient.documents == {}
    serialized = report_file.read_text(encoding="utf-8")
    assert "token-a" not in serialized and "token-b" not in serialized


@pytest.mark.p1
def test_live_data_plane_gate_requires_explicit_write_authorization(monkeypatch):
    FakeGatewayClient.reset()
    monkeypatch.setattr(gate, "GatewayClient", FakeGatewayClient)
    with pytest.raises(AssertionError, match="allow_writes"):
        gate.run_gate("https://gateway.example.com", "token-a", "token-b")


def test_live_gate_rejects_untrusted_roots_and_unsafe_multipart_names():
    with pytest.raises(AssertionError, match="HTTPS"):
        gate.GatewayClient("http://gateway.example.com", "token")
    with pytest.raises(AssertionError, match="HTTP or HTTPS"):
        gate.GatewayClient("ftp://localhost", "token")
    with pytest.raises(AssertionError, match="plain"):
        gate._multipart_file("file", "../secret.txt", b"secret", "text/plain")
    with pytest.raises(AssertionError, match="plain"):
        gate._multipart_file('file"', "safe.txt", b"secret", "text/plain")
