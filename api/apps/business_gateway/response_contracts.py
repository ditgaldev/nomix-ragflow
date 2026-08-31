#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Canonical successful-response contracts for the Business Gateway."""

from __future__ import annotations

import re
from typing import Any

from .capabilities import capabilities

S = {"type": "string"}
NS = {"type": ["string", "null"]}
N = {"type": "number"}
NN = {"type": ["number", "null"]}
I = {"type": "integer"}
NI = {"type": ["integer", "null"]}
B = {"type": "boolean"}
NB = {"type": ["boolean", "null"]}
J = {}
JO = {"type": "object", "additionalProperties": True}
SA = {"type": "array", "items": S}


def _object(
    properties: dict[str, dict[str, Any]] | None = None,
    required: tuple[str, ...] = (),
    *,
    additional_properties: bool | dict[str, Any] = False,
) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": "object",
        "additionalProperties": additional_properties,
        "properties": properties or {},
    }
    if required:
        schema["required"] = list(required)
    return schema


def _array(item: dict[str, Any]) -> dict[str, Any]:
    return {"type": "array", "items": item}


def _ref(name: str) -> dict[str, str]:
    return {"$ref": f"#/components/schemas/{name}"}


TIMESTAMPS = {
    "createTime": NI,
    "createDate": NS,
    "updateTime": NI,
    "updateDate": NS,
}

RESOURCE_SCHEMAS: dict[str, dict[str, Any]] = {
    "Dataset": _object(
        {
            "id": S,
            "version": I,
            "name": S,
            "avatar": NS,
            "language": NS,
            "description": NS,
            "embeddingModel": S,
            "permission": S,
            "documentCount": I,
            "tokenCount": I,
            "chunkCount": I,
            "similarityThreshold": N,
            "vectorSimilarityWeight": N,
            "chunkMethod": S,
            "pipelineId": NS,
            "parserConfig": JO,
            "autoMetadataConfig": JO,
            "pagerank": I,
            "status": NS,
            **TIMESTAMPS,
        },
        ("id", "version", "name"),
    ),
    "Document": _object(
        {
            "id": S,
            "version": I,
            "datasetId": S,
            "name": NS,
            "thumbnail": NS,
            "chunkMethod": S,
            "pipelineId": NS,
            "parserConfig": JO,
            "sourceType": S,
            "type": S,
            "location": NS,
            "size": I,
            "tokenCount": I,
            "chunkCount": I,
            "progress": N,
            "progressMsg": NS,
            "processBeginAt": J,
            "processDuration": N,
            "suffix": S,
            "contentHash": NS,
            "run": NS,
            "status": NS,
            "metaFields": JO,
            **TIMESTAMPS,
        },
        ("id", "version", "datasetId"),
    ),
    "Chunk": _object(
        {
            "id": S,
            "version": I,
            "content": S,
            "datasetId": S,
            "documentId": S,
            "documentName": NS,
            "documentKeyword": NS,
            "importantKeywords": SA,
            "questions": SA,
            "imageId": NS,
            "documentType": NS,
            "available": B,
            "positions": _array(_array(I)),
            "tags": SA,
            "tagFeatures": JO,
            "similarity": NN,
            "score": NN,
            "highlight": J,
            "metadata": JO,
        },
        ("id", "content"),
    ),
    "Chat": _object(
        {
            "id": S,
            "version": I,
            "name": NS,
            "description": NS,
            "icon": NS,
            "language": NS,
            "llmId": S,
            "llmSetting": JO,
            "promptType": S,
            "promptConfig": JO,
            "metaDataFilter": JO,
            "similarityThreshold": N,
            "vectorSimilarityWeight": N,
            "topN": I,
            "topK": I,
            "doRefer": S,
            "rerankId": S,
            "datasetIds": SA,
            "status": NS,
            **TIMESTAMPS,
        },
        ("id", "version"),
    ),
    "Session": _object(
        {
            "id": S,
            "version": I,
            "ownerId": S,
            "name": NS,
            "message": _array(J),
            "reference": J,
            "tokens": I,
            "source": NS,
            "dsl": JO,
            "duration": N,
            "round": I,
            "thumbUp": I,
            "errors": NS,
            "versionTitle": NS,
            **TIMESTAMPS,
        },
        ("id", "version", "ownerId"),
    ),
    "Agent": _object(
        {
            "id": S,
            "version": I,
            "avatar": NS,
            "title": NS,
            "permission": S,
            "release": B,
            "description": NS,
            "canvasType": NS,
            "canvasCategory": S,
            "tags": S,
            "dsl": JO,
            **TIMESTAMPS,
        },
        ("id", "version"),
    ),
    "Memory": _object(
        {
            "id": S,
            "version": I,
            "name": S,
            "avatar": NS,
            "memoryType": {"type": ["array", "integer"], "items": S},
            "storageType": S,
            "embdId": S,
            "embdName": NS,
            "llmId": S,
            "permissions": S,
            "description": NS,
            "memorySize": I,
            "forgettingPolicy": S,
            "temperature": N,
            "systemPrompt": NS,
            "userPrompt": NS,
            "ownerName": NS,
            **TIMESTAMPS,
        },
        ("id", "version", "name"),
    ),
    "MemoryMessage": _object(
        {
            "messageId": I,
            "messageType": NS,
            "sourceId": NI,
            "memoryId": S,
            "agentId": NS,
            "sessionId": NS,
            "validAt": J,
            "invalidAt": J,
            "forgetAt": J,
            "status": NB,
            "content": J,
            "extract": _array(JO),
            "agentName": NS,
            "task": JO,
            "similarity": NN,
        },
        ("messageId", "memoryId"),
    ),
    "MetadataConfig": _object(
        {
            "metadata": _array(JO),
            "builtInMetadata": SA,
        },
    ),
    "CommandResult": _object({"successCount": I}, ("successCount",)),
    "SessionInvocation": _object(
        {
            "content": S,
            "role": {"type": "string", "const": "assistant"},
            "sessionId": S,
            "reference": J,
            "trace": J,
        },
        ("content", "role", "sessionId"),
    ),
    "RetrievalResult": _object(
        {
            "chunks": _array(_ref("RetrievalChunk")),
            "total": I,
            "docAggs": J,
        },
        ("chunks", "total", "docAggs"),
    ),
}

# Knowledge-graph retrieval may produce a synthetic chunk without a persisted id;
# management operations continue to use the stricter Chunk contract.
RESOURCE_SCHEMAS["RetrievalChunk"] = {
    **RESOURCE_SCHEMAS["Chunk"],
    "required": ["content"],
}


def _response_data_contracts() -> dict[str, dict[str, Any]]:
    contracts: dict[str, dict[str, Any]] = {
        "authorization.context": _ref("BusinessAuthorizationContext"),
        "retrieval.search": _ref("RetrievalResult"),
    }

    def add(names: tuple[str, ...], schema: dict[str, Any]) -> None:
        for name in names:
            contracts[name] = schema

    add(("datasets.list",), _array(_ref("Dataset")))
    add(("datasets.create", "datasets.get", "datasets.update"), _ref("Dataset"))
    add(("datasets.delete", "datasets.batchDelete"), _ref("CommandResult"))
    add(("datasets.getMetadataConfig", "datasets.updateMetadataConfig"), _ref("MetadataConfig"))

    add(("documents.list", "documents.upload"), _array(_ref("Document")))
    add(("documents.get", "documents.update"), _ref("Document"))
    add(("documents.delete", "documents.batchDelete", "documents.startParse", "documents.cancelParse"), _ref("CommandResult"))

    add(("chunks.list",), _array(_ref("Chunk")))
    add(("chunks.create", "chunks.get", "chunks.update"), _ref("Chunk"))
    add(("chunks.delete", "chunks.batchDelete"), _ref("CommandResult"))

    add(("chats.list",), _array(_ref("Chat")))
    add(("chats.create", "chats.get", "chats.update"), _ref("Chat"))
    add(("chats.delete", "chats.batchDelete"), _ref("CommandResult"))

    add(("chatSessions.list", "agentSessions.list"), _array(_ref("Session")))
    add(("chatSessions.create", "chatSessions.get", "chatSessions.update", "agentSessions.create", "agentSessions.get"), _ref("Session"))
    add(("chatSessions.delete", "chatSessions.batchDelete", "agentSessions.delete", "agentSessions.batchDelete"), _ref("CommandResult"))
    add(("chatSessions.invoke", "agentSessions.invoke"), _ref("SessionInvocation"))

    add(("agents.list",), _array(_ref("Agent")))
    add(("agents.create", "agents.get", "agents.update"), _ref("Agent"))
    add(("agents.delete",), _ref("CommandResult"))

    add(("memories.list",), _array(_ref("Memory")))
    add(("memories.create", "memories.get", "memories.update", "memories.getConfig"), _ref("Memory"))
    add(("memories.delete",), _ref("CommandResult"))

    add(("memoryMessages.list", "memoryMessages.search", "memoryMessages.recent"), _array(_ref("MemoryMessage")))
    add(("memoryMessages.getContent",), _ref("MemoryMessage"))
    add(
        ("memoryMessages.create", "memoryMessages.batchCreate", "memoryMessages.update", "memoryMessages.delete"),
        _ref("CommandResult"),
    )

    expected = {capability.operation for capability in capabilities() if capability.operation != "documents.download"}
    if set(contracts) != expected:
        raise RuntimeError(f"Business Gateway response contracts drifted: {sorted(expected ^ set(contracts))}")
    return contracts


RESPONSE_DATA_CONTRACTS = _response_data_contracts()


def response_data_schema(operation: str) -> dict[str, Any]:
    return RESPONSE_DATA_CONTRACTS[operation]


def project_response_data(operation: str, value: Any) -> Any:
    """Validate and project adapter output onto the public operation schema."""

    def matches_type(member: Any, expected: Any) -> bool:
        if isinstance(expected, list):
            return any(matches_type(member, candidate) for candidate in expected)
        if expected == "null":
            return member is None
        if expected == "boolean":
            return isinstance(member, bool)
        if expected == "integer":
            return isinstance(member, int) and not isinstance(member, bool)
        if expected == "number":
            return isinstance(member, (int, float)) and not isinstance(member, bool)
        if expected == "string":
            return isinstance(member, str)
        if expected == "array":
            return isinstance(member, list)
        if expected == "object":
            return isinstance(member, dict)
        return True

    def project(schema: dict[str, Any], member: Any) -> Any:
        reference = schema.get("$ref")
        if isinstance(reference, str):
            target = RESOURCE_SCHEMAS.get(reference.rsplit("/", 1)[-1])
            return member if target is None else project(target, member)
        expected_type = schema.get("type")
        if expected_type is not None and not matches_type(member, expected_type):
            raise RuntimeError(f"Business Gateway {operation} produced data outside its response contract")
        if "const" in schema and member != schema["const"]:
            raise RuntimeError(f"Business Gateway {operation} produced data outside its response contract")
        accepts_array = expected_type == "array" or (isinstance(expected_type, list) and "array" in expected_type)
        if accepts_array and isinstance(member, list):
            item_schema = schema.get("items")
            return [project(item_schema, item) for item in member] if isinstance(item_schema, dict) else list(member)
        if expected_type != "object":
            return member
        properties = schema.get("properties")
        if not isinstance(properties, dict):
            return dict(member)
        result = {name: project(property_schema, member[name]) for name, property_schema in properties.items() if name in member and isinstance(property_schema, dict)}
        required = schema.get("required", [])
        if any(not isinstance(name, str) or name not in result for name in required):
            raise RuntimeError(f"Business Gateway {operation} produced data outside its response contract")
        additional = schema.get("additionalProperties")
        if additional is True:
            result.update({name: item for name, item in member.items() if name not in properties})
        elif isinstance(additional, dict):
            result.update({name: project(additional, item) for name, item in member.items() if name not in properties})
        return result

    return project(response_data_schema(operation), value)


def response_component_name(operation: str) -> str:
    words = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|[0-9]+", operation.replace(".", " "))
    return "".join(word[:1].upper() + word[1:] for word in words) + "Response"


def operation_response_schemas() -> dict[str, dict[str, Any]]:
    return {
        response_component_name(operation): _object(
            {
                "data": schema,
                "meta": _ref("SuccessMeta"),
            },
            ("data", "meta"),
        )
        for operation, schema in RESPONSE_DATA_CONTRACTS.items()
    }
