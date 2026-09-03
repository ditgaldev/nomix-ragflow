#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Closed public request contracts for every Business Gateway operation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .capabilities import capabilities
from .errors import BusinessGatewayError

S = {"type": "string"}
N = {"type": "number"}
I = {"type": "integer"}
B = {"type": "boolean"}
O = {"type": "object"}
SA = {"type": "array", "items": S}


@dataclass(frozen=True)
class RequestContract:
    body: dict[str, Any] | None = None
    query: dict[str, Any] | None = None
    multipart: dict[str, Any] | None = None


def _object(properties: dict[str, dict[str, Any]] | None = None, required: tuple[str, ...] = ()) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "object", "additionalProperties": False, "properties": properties or {}}
    if required:
        schema["required"] = list(required)
    return schema


PAGE = {"cursor": S, "limit": I}
IDS = _object({"ids": SA}, ("ids",))
EMPTY = _object()
REFERENCE_METADATA = _object({"include": B, "fields": SA}, ("include",))

DATASET_FIELDS = {
    "name": S,
    "avatar": S,
    "description": S,
    "embeddingModel": S,
    "chunkMethod": S,
    "parserConfig": O,
    "autoMetadataConfig": O,
    "language": S,
    "pagerank": N,
    "pipelineId": S,
}
DOCUMENT_FIELDS = {"name": S, "chunkMethod": S, "parserConfig": O, "pipelineId": S, "enabled": B, "metaFields": O}
CHUNK_FIELDS = {
    "content": S,
    "importantKeywords": SA,
    "questions": SA,
    "available": B,
    "positions": {"type": "array", "items": {"type": "array", "items": I}},
}
CHAT_FIELDS = {
    "name": S,
    "icon": S,
    "description": S,
    "datasetIds": SA,
    "llmId": S,
    "llmSetting": O,
    "promptConfig": O,
    "topN": I,
    "topK": I,
    "similarityThreshold": N,
    "vectorSimilarityWeight": N,
    "rerankId": S,
}
AGENT_FIELDS = {"title": S, "dsl": O, "description": S, "canvasType": S, "release": B}
SESSION_FIELDS = {"name": S, "inputs": O}
INVOKE_FIELDS = {"question": S, "inputs": O, "release": B, "returnTrace": B, "stream": B}
MEMORY_FIELDS = {
    "name": S,
    "memoryType": SA,
    "embdId": S,
    "llmId": S,
    "description": S,
    "memorySize": I,
    "forgettingPolicy": S,
    "temperature": N,
    "avatar": S,
    "systemPrompt": S,
    "userPrompt": S,
}
MESSAGE_FIELDS = {
    "memoryIds": SA,
    "agentId": S,
    "sessionId": S,
    "userInput": S,
    "agentResponse": S,
    "messageId": I,
    "status": B,
}


def _contracts() -> dict[str, RequestContract]:
    contracts: dict[str, RequestContract] = {}

    def add(names: tuple[str, ...], *, body=None, query=None, multipart=None):
        for name in names:
            contracts[name] = RequestContract(body=body, query=query, multipart=multipart)

    add(
        ("retrieval.search",),
        body=_object(
            {
                "datasetIds": SA,
                "documentIds": SA,
                "question": S,
                "cursor": S,
                "limit": I,
                "similarityThreshold": N,
                "vectorSimilarityWeight": N,
                "topK": I,
                "rerankId": S,
                "keyword": B,
                "crossLanguages": SA,
                "metadataCondition": O,
                "useKg": B,
                "tocEnhance": B,
                "highlight": B,
                "referenceMetadata": REFERENCE_METADATA,
            },
            ("question",),
        ),
    )
    add(
        ("pageIndex.search",),
        body=_object(
            {
                "datasetIds": {"type": "array", "items": S, "minItems": 1, "maxItems": 20},
                "documentIds": {"type": "array", "items": S, "minItems": 1, "maxItems": 20},
                "question": S,
                "limit": I,
            },
            ("datasetIds", "documentIds", "question"),
        ),
    )
    add(("pageIndex.build",), body=_object({"documentIds": {"type": "array", "items": S, "minItems": 1, "maxItems": 20}}, ("documentIds",)))
    add(("datasets.list",), query=_object({**PAGE, "id": S, "ids": SA, "name": S}))
    add(("datasets.create",), body=_object(DATASET_FIELDS, ("name",)))
    add(("datasets.update",), body=_object(DATASET_FIELDS))
    add(("datasets.delete",), body=EMPTY)
    add(("datasets.batchDelete",), body=IDS)
    add(("datasets.updateMetadataConfig",), body=_object({"metadata": {"type": "array", "items": O}, "builtInMetadata": SA}))
    add(("documents.list",), query=_object({**PAGE, "id": S, "ids": SA, "name": S, "keywords": S, "createTimeFrom": I, "createTimeTo": I}))
    add(("documents.upload",), multipart=_object({"file": {"type": "array", "minItems": 1, "items": {"type": "string", "format": "binary"}}}, ("file",)))
    add(("documents.update",), body=_object(DOCUMENT_FIELDS))
    add(("documents.delete",), body=EMPTY)
    add(("documents.batchDelete",), body=IDS)
    add(("documents.startParse", "documents.cancelParse"), body=_object({"documentIds": SA}, ("documentIds",)))
    add(("chunks.list",), query=_object({**PAGE, "id": S, "keywords": S}))
    add(("chunks.create",), body=_object(CHUNK_FIELDS, ("content",)))
    add(("chunks.update",), body=_object(CHUNK_FIELDS))
    add(("chunks.delete",), body=EMPTY)
    add(("chunks.batchDelete",), body=IDS)
    add(("chats.list",), query=_object({**PAGE, "id": S, "name": S, "keywords": S}))
    add(("chats.create",), body=_object(CHAT_FIELDS, ("name",)))
    add(("chats.update",), body=_object(CHAT_FIELDS))
    add(("chats.delete",), body=EMPTY)
    add(("chats.batchDelete",), body=IDS)
    add(("chatSessions.list", "agentSessions.list"), query=_object({**PAGE, "id": S, "name": S}))
    add(("chatSessions.create", "agentSessions.create"), body=_object(SESSION_FIELDS))
    add(("chatSessions.update",), body=_object({"name": S}))
    add(("chatSessions.delete", "agentSessions.delete"), body=EMPTY)
    add(("chatSessions.batchDelete", "agentSessions.batchDelete"), body=IDS)
    add(("chatSessions.invoke", "agentSessions.invoke"), body=_object(INVOKE_FIELDS, ("question",)))
    add(("agents.list",), query=_object(PAGE))
    add(("agents.create",), body=_object(AGENT_FIELDS, ("title", "dsl")))
    add(("agents.update",), body=_object(AGENT_FIELDS))
    add(("agents.delete",), body=EMPTY)
    add(("memories.list",), query=_object({**PAGE, "memoryType": SA, "storageType": S, "keywords": S}))
    add(("memories.create",), body=_object(MEMORY_FIELDS, ("name", "memoryType", "embdId", "llmId")))
    add(("memories.update",), body=_object(MEMORY_FIELDS))
    add(("memories.delete",), body=EMPTY)
    add(("memoryMessages.list",), query=_object(PAGE))
    add(("memoryMessages.create",), body=_object({k: v for k, v in MESSAGE_FIELDS.items() if k != "memoryIds"}, ("agentId", "sessionId", "userInput", "agentResponse")))
    add(("memoryMessages.batchCreate",), body=_object(MESSAGE_FIELDS, ("memoryIds", "agentId", "sessionId", "userInput", "agentResponse")))
    add(
        ("memoryMessages.search",),
        query=_object(
            {
                "query": S,
                "memoryIds": SA,
                "agentId": S,
                "sessionId": S,
                "similarityThreshold": N,
                "keywordsSimilarityWeight": N,
                "topN": I,
            },
            ("query", "memoryIds"),
        ),
    )
    add(("memoryMessages.recent",), query=_object({"memoryIds": SA, "agentId": S, "sessionId": S, "limit": I}, ("memoryIds",)))
    add(("memoryMessages.update",), body=_object({"status": B}, ("status",)))
    add(("memoryMessages.delete",), body=EMPTY)

    no_input = {
        "authorization.context",
        "datasets.get",
        "datasets.getMetadataConfig",
        "documents.get",
        "pageIndex.get",
        "pageIndex.status",
        "documents.download",
        "chunks.get",
        "chats.get",
        "agents.get",
        "memories.get",
        "memories.getConfig",
        "chatSessions.get",
        "agentSessions.get",
        "memoryMessages.getContent",
    }
    add(tuple(no_input))
    expected = {capability.operation for capability in capabilities()}
    if set(contracts) != expected:
        raise RuntimeError(f"Business Gateway request contracts drifted: {sorted(expected ^ set(contracts))}")
    return contracts


CONTRACTS = _contracts()

_TRUSTED_CONTEXT_KEYS = {
    "actions",
    "actorsubject",
    "authenticationtype",
    "datasetscope",
    "documentscope",
    "chatscope",
    "agentscope",
    "memoryscope",
    "executionuserid",
    "onbehalfofsubject",
    "permissionref",
    "requestid",
    "subject",
    "tenantid",
    "userid",
    "workspaceid",
}


def contract_for(operation: str) -> RequestContract:
    return CONTRACTS[operation]


def validate_request(operation: str, payload: dict[str, Any] | None, query: dict[str, Any]) -> None:
    _reject_trusted_context(payload or {}, "body")
    _reject_trusted_context(query, "query")
    contract = contract_for(operation)
    if contract.query is not None:
        _validate_object(query, contract.query, "query")
    elif query:
        _unknown("query", set(query))
    if contract.body is not None:
        _validate_object(payload or {}, contract.body, "body")
    elif contract.multipart is not None:
        _validate_object(payload or {}, contract.multipart, "body")
    elif payload:
        _unknown("body", set(payload))


def _validate_object(value: dict[str, Any], schema: dict[str, Any], location: str) -> None:
    properties = schema.get("properties", {})
    unknown = set(value) - set(properties)
    if unknown:
        _unknown(location, unknown)
    missing = set(schema.get("required", [])) - set(value)
    if missing:
        raise BusinessGatewayError("INVALID_REQUEST", f"Missing required {location} fields: {', '.join(sorted(missing))}.", status=400)
    if location == "body":
        for name, member in value.items():
            expected = properties[name].get("type")
            valid = {
                "string": isinstance(member, str),
                "number": isinstance(member, (int, float)) and not isinstance(member, bool),
                "integer": isinstance(member, int) and not isinstance(member, bool),
                "boolean": isinstance(member, bool),
                "object": isinstance(member, dict),
                "array": isinstance(member, list),
            }.get(expected, True)
            if not valid:
                raise BusinessGatewayError("INVALID_REQUEST", f"Field {name} has an invalid type.", status=400)


def _unknown(location: str, names: set[str]) -> None:
    raise BusinessGatewayError("INVALID_REQUEST", f"Unknown {location} fields: {', '.join(sorted(names))}.", status=400)


def _reject_trusted_context(value: Any, location: str) -> None:
    if isinstance(value, dict):
        for key, member in value.items():
            normalized = "".join(character for character in str(key).lower() if character.isalnum())
            if normalized in _TRUSTED_CONTEXT_KEYS:
                raise BusinessGatewayError(
                    "INVALID_REQUEST",
                    f"Trusted authorization field {key} is not accepted in the public {location} contract.",
                    status=400,
                )
            _reject_trusted_context(member, location)
    elif isinstance(value, list):
        for member in value:
            _reject_trusted_context(member, location)
