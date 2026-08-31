#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

from .capabilities import capabilities, requires_resource_version
from .contracts import contract_for
from .response_contracts import RESOURCE_SCHEMAS, operation_response_schemas, response_component_name


def build_openapi() -> dict:
    paths: dict[str, dict] = {}
    for capability in capabilities():
        contract = contract_for(capability.operation)
        success_status = _success_status(capability.operation)
        success_response = {
            "description": "Successful Business Gateway response",
            "content": {"application/json": {"schema": {"$ref": f"#/components/schemas/{response_component_name(capability.operation)}"}}},
        }
        if capability.operation == "documents.download":
            success_response = {
                "description": "Authorized document content",
                "headers": {
                    "X-Request-Id": {"schema": {"type": "string"}},
                    "Cache-Control": {"schema": {"type": "string", "const": "no-store"}},
                },
                "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
            }
        operation: dict = {
            "operationId": capability.operation,
            "tags": [capability.resource_type],
            "security": [{"businessAccessToken": []}],
            "x-nomix-required-action": capability.required_action,
            "x-nomix-additional-required-actions": list(capability.additional_required_actions),
            "x-nomix-risk": capability.risk,
            "x-nomix-idempotency": capability.idempotency,
            "x-nomix-optimistic-concurrency": "required" if requires_resource_version(capability.operation) else "none",
            "x-nomix-client-method": capability.client_method,
            "responses": {
                success_status: success_response,
                "400": {"$ref": "#/components/responses/Error"},
                "401": {"$ref": "#/components/responses/Error"},
                "403": {"$ref": "#/components/responses/Error"},
                "404": {"$ref": "#/components/responses/Error"},
                "409": {"$ref": "#/components/responses/Error"},
                "413": {"$ref": "#/components/responses/Error"},
                "503": {"$ref": "#/components/responses/Error"},
            },
        }
        if capability.agent_tool:
            operation["x-nomix-agent-tool"] = capability.agent_tool
            operation["x-nomix-agent-action"] = capability.agent_action
        if capability.agent_kind:
            operation["x-nomix-agent-kind"] = capability.agent_kind
        parameters = []
        for segment in capability.path.split("/"):
            if segment.startswith("{") and segment.endswith("}"):
                parameters.append(
                    {
                        "name": segment[1:-1],
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string", "minLength": 1},
                    }
                )
        if contract.query is not None:
            required_query = set(contract.query.get("required", []))
            for name, schema in contract.query.get("properties", {}).items():
                parameters.append({"name": name, "in": "query", "required": name in required_query, "schema": schema})
        if capability.idempotency in {"required", "supported"}:
            parameters.append(
                {
                    "name": "Idempotency-Key",
                    "in": "header",
                    "required": capability.idempotency == "required",
                    "schema": {"type": "string", "minLength": 1, "maxLength": 255},
                }
            )
        if requires_resource_version(capability.operation):
            parameters.append(
                {
                    "name": "If-Match",
                    "in": "header",
                    "required": True,
                    "description": "Current numeric resource version returned by the Business Gateway.",
                    "schema": {"oneOf": [{"type": "integer", "minimum": 1}, {"type": "string", "pattern": "^[1-9][0-9]*$"}]},
                }
            )
            operation["responses"]["428"] = {"$ref": "#/components/responses/Error"}
        if parameters:
            operation["parameters"] = parameters
        if contract.body is not None:
            operation["requestBody"] = {
                "required": bool(contract.body.get("required")) or capability.method == "POST",
                "content": {"application/json": {"schema": contract.body}},
            }
        elif contract.multipart is not None:
            operation["requestBody"] = {
                "required": True,
                "content": {"multipart/form-data": {"schema": contract.multipart}},
            }
        paths.setdefault(f"/api/v1{capability.path}", {})[capability.method.lower()] = operation

    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Nomix RAGFlow Business Gateway",
            "version": "1.0.0",
            "x-nomix-standard-version": "v1",
        },
        "servers": [{"url": "/"}],
        "paths": paths,
        "components": {
            "securitySchemes": {
                "businessAccessToken": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "opaque business access token",
                }
            },
            "schemas": {
                "ResourceScope": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["mode"],
                    "properties": {
                        "mode": {"type": "string", "enum": ["all", "ids", "inherit", "none"]},
                        "ids": {"type": "array", "items": {"type": "string"}, "uniqueItems": True},
                    },
                },
                "BusinessAuthorizationContext": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "subject",
                        "actorSubject",
                        "onBehalfOfSubject",
                        "workspaceId",
                        "actions",
                        "datasetScope",
                        "documentScope",
                        "chatScope",
                        "agentScope",
                        "memoryScope",
                        "permissionRef",
                        "authenticationType",
                        "requestId",
                        "tokenUse",
                        "audience",
                        "expiresAt",
                        "clientId",
                    ],
                    "properties": {
                        "subject": {"type": "string"},
                        "actorSubject": {"type": "string"},
                        "onBehalfOfSubject": {"type": ["string", "null"]},
                        "workspaceId": {"type": "string"},
                        "actions": {"type": "array", "items": {"type": "string"}, "uniqueItems": True},
                        "datasetScope": {"$ref": "#/components/schemas/ResourceScope"},
                        "documentScope": {"$ref": "#/components/schemas/ResourceScope"},
                        "chatScope": {"$ref": "#/components/schemas/ResourceScope"},
                        "agentScope": {"$ref": "#/components/schemas/ResourceScope"},
                        "memoryScope": {"$ref": "#/components/schemas/ResourceScope"},
                        "permissionRef": {"type": ["string", "null"]},
                        "authenticationType": {"type": "string", "const": "token-introspection"},
                        "requestId": {"type": "string"},
                        "tokenUse": {"type": "string", "const": "data"},
                        "audience": {"type": "array", "items": {"type": "string"}},
                        "expiresAt": {"type": "string", "format": "date-time"},
                        "clientId": {"type": ["string", "null"]},
                    },
                },
                "SuccessMeta": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["requestId"],
                    "properties": {
                        "requestId": {"type": "string"},
                        "limit": {"type": "integer"},
                        "hasNext": {"type": "boolean"},
                        "nextCursor": {"type": ["string", "null"]},
                    },
                },
                **RESOURCE_SCHEMAS,
                **operation_response_schemas(),
                "ErrorEnvelope": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["error"],
                    "properties": {
                        "error": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["code", "message", "requestId", "retryable"],
                            "properties": {
                                "code": {"type": "string"},
                                "message": {"type": "string"},
                                "requestId": {"type": "string"},
                                "details": {},
                                "retryable": {"type": "boolean"},
                            },
                        }
                    },
                },
            },
            "responses": {
                "Error": {
                    "description": "Business Gateway error",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}},
                }
            },
        },
    }


def _success_status(operation: str) -> str:
    if operation.endswith(".create") or operation in {"datasets.create", "documents.upload", "memoryMessages.batchCreate"}:
        return "201"
    if operation in {"documents.startParse", "documents.cancelParse"}:
        return "202"
    return "200"
