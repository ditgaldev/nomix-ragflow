#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from peewee import IntegrityError

from api.db.db_models import DB
from common.misc_utils import get_uuid

from .capabilities import Capability
from .errors import BusinessGatewayError
from .models import BusinessGatewayExecutionIntent, BusinessGatewayIdempotencyRecord
from .recovery import RecoveryPlan
from .types import RagFlowExecutionContext

IDEMPOTENCY_TTL = timedelta(hours=24)
RESERVATION_LEASE = timedelta(minutes=2)
EXECUTION_RECOVERY_LEASE = timedelta(minutes=30)
MAX_KEY_LENGTH = 255


def _utc_now() -> datetime:
    """Return a naive UTC timestamp for the existing Peewee DateTimeField convention."""
    return datetime.now(UTC).replace(tzinfo=None)


@dataclass(frozen=True)
class IdempotencyReplay:
    status: int
    body: dict[str, Any]
    headers: dict[str, str]


@dataclass(frozen=True)
class IdempotencyReservation:
    record_id: str | None
    key_hash: str | None
    replay: IdempotencyReplay | None = None
    execution_started: bool = False
    recovery_required: bool = False
    lookup_hash: str | None = None
    authorization_hash: str | None = None


def request_fingerprint(
    capability: Capability,
    path_args: dict[str, Any],
    query: dict[str, Any],
    payload: Any,
) -> str:
    normalized = json.dumps(
        {
            "operation": capability.operation,
            "method": capability.method,
            "path": path_args,
            "query": query,
            "body": payload,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def lookup_existing_for_recovery(
    capability: Capability,
    context: RagFlowExecutionContext,
    key: str | None,
    fingerprint: str,
) -> IdempotencyReservation | None:
    """Find a prior exact command before a deleted resource can fail normal ACL lookup."""

    if key is None or not key.strip():
        return None
    normalized_key = key.strip()
    if len(normalized_key) > MAX_KEY_LENGTH:
        raise BusinessGatewayError(
            "INVALID_IDEMPOTENCY_KEY",
            f"Idempotency-Key must not exceed {MAX_KEY_LENGTH} characters.",
            status=400,
            request_id=context.request_id,
        )
    lookup_hash = _lookup_hash(capability.operation, context, normalized_key)
    authorization_hash = _authorization_snapshot_hash(context)
    intents = (
        BusinessGatewayExecutionIntent.select()
        .where(
            (BusinessGatewayExecutionIntent.lookup_hash == lookup_hash)
            & (BusinessGatewayExecutionIntent.authorization_hash == authorization_hash)
            & (BusinessGatewayExecutionIntent.operation == capability.operation)
        )
        .order_by(BusinessGatewayExecutionIntent.id.desc())
    )
    now = _utc_now()
    for intent in intents:
        record = BusinessGatewayIdempotencyRecord.get_or_none(BusinessGatewayIdempotencyRecord.id == intent.id)
        if record is None or record.tenant_id != context.tenant_id or record.subject != context.subject or record.operation != capability.operation:
            continue
        if record.request_hash != fingerprint:
            raise BusinessGatewayError(
                "IDEMPOTENCY_CONFLICT",
                "The Idempotency-Key was already used with a different request.",
                status=409,
                request_id=context.request_id,
            )
        if record.state == "completed" and record.response_status is not None and record.response_body is not None:
            try:
                body = json.loads(record.response_body)
            except json.JSONDecodeError as error:
                raise BusinessGatewayError(
                    "IDEMPOTENCY_UNAVAILABLE",
                    "The stored idempotent response is invalid.",
                    status=503,
                    request_id=context.request_id,
                    retryable=True,
                ) from error
            return IdempotencyReservation(
                str(record.id),
                str(record.key_hash),
                IdempotencyReplay(int(record.response_status), body, record.response_headers or {}),
                lookup_hash=lookup_hash,
                authorization_hash=authorization_hash,
            )
        if record.state == "executing" and intent.recover_after > now:
            raise BusinessGatewayError(
                "IDEMPOTENCY_IN_PROGRESS",
                "A request with this Idempotency-Key is still within its execution lease.",
                status=409,
                request_id=context.request_id,
                retryable=True,
            )
        if record.state in {"executing", "uncertain"}:
            return IdempotencyReservation(
                str(record.id),
                str(record.key_hash),
                execution_started=True,
                recovery_required=True,
                lookup_hash=lookup_hash,
                authorization_hash=authorization_hash,
            )
    return None


def _lookup_hash(operation: str, context: RagFlowExecutionContext, key: str) -> str:
    raw = f"{context.tenant_id}\0{context.subject}\0{operation}\0{key}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _authorization_snapshot_hash(context: RagFlowExecutionContext) -> str:
    value = {
        "authority": context.authority,
        "workspaceBindingId": context.workspace_binding_id,
        "workspaceId": context.workspace_id,
        "tenantId": context.tenant_id,
        "executionUserId": context.execution_user_id,
        "subject": context.subject,
        "actorSubject": context.actor_subject,
        "onBehalfOfSubject": context.on_behalf_of_subject,
        "permissionRef": context.permission_ref,
        "datasetScope": {"mode": context.dataset_scope.mode, "ids": sorted(context.dataset_scope.ids)},
        "documentScope": {"mode": context.document_scope.mode, "ids": sorted(context.document_scope.ids)},
        "chatScope": {"mode": context.chat_scope.mode, "ids": sorted(context.chat_scope.ids)},
        "agentScope": {"mode": context.agent_scope.mode, "ids": sorted(context.agent_scope.ids)},
        "memoryScope": {"mode": context.memory_scope.mode, "ids": sorted(context.memory_scope.ids)},
    }
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def reserve(
    capability: Capability,
    context: RagFlowExecutionContext,
    key: str | None,
    fingerprint: str,
    authorization_scope_hash: str,
) -> IdempotencyReservation:
    if capability.idempotency == "none":
        return IdempotencyReservation(None, None)
    if key is None or not key.strip():
        if capability.idempotency == "required":
            raise BusinessGatewayError(
                "IDEMPOTENCY_KEY_REQUIRED",
                "Idempotency-Key is required for this operation.",
                status=400,
                request_id=context.request_id,
            )
        return IdempotencyReservation(None, None)
    key = key.strip()
    if len(key) > MAX_KEY_LENGTH:
        raise BusinessGatewayError(
            "INVALID_IDEMPOTENCY_KEY",
            f"Idempotency-Key must not exceed {MAX_KEY_LENGTH} characters.",
            status=400,
            request_id=context.request_id,
        )
    # Do not use the access-token fingerprint: token rotation must preserve
    # idempotency.  The verified authorization snapshot prevents a replay
    # after workspace mapping, externally resolved scopes, or effective ACL changes.
    authorization_snapshot = {
        "workspaceBindingId": context.workspace_binding_id,
        "executionUserId": context.execution_user_id,
        "permissionRef": context.permission_ref,
        "datasetScope": {
            "mode": context.dataset_scope.mode,
            "ids": sorted(context.dataset_scope.ids),
        },
        "documentScope": {
            "mode": context.document_scope.mode,
            "ids": sorted(context.document_scope.ids),
        },
        "chatScope": {
            "mode": context.chat_scope.mode,
            "ids": sorted(context.chat_scope.ids),
        },
        "agentScope": {
            "mode": context.agent_scope.mode,
            "ids": sorted(context.agent_scope.ids),
        },
        "memoryScope": {
            "mode": context.memory_scope.mode,
            "ids": sorted(context.memory_scope.ids),
        },
        "authorizationScopeHash": authorization_scope_hash,
    }
    namespace = json.dumps(
        authorization_snapshot,
        sort_keys=True,
        separators=(",", ":"),
    )
    key_hash = hashlib.sha256(f"{namespace}\0{key}".encode()).hexdigest()
    lookup_hash = _lookup_hash(capability.operation, context, key)
    authorization_hash = _authorization_snapshot_hash(context)
    now = _utc_now()
    cleanup_expired(now)
    record_id = get_uuid()
    try:
        with DB.atomic():
            BusinessGatewayIdempotencyRecord.create(
                id=record_id,
                tenant_id=context.tenant_id,
                subject=context.subject,
                operation=capability.operation,
                key_hash=key_hash,
                request_hash=fingerprint,
                state="reserved",
                expires_at=now + RESERVATION_LEASE,
            )
        return IdempotencyReservation(record_id, key_hash, lookup_hash=lookup_hash, authorization_hash=authorization_hash)
    except IntegrityError:
        existing = BusinessGatewayIdempotencyRecord.get_or_none(
            (BusinessGatewayIdempotencyRecord.tenant_id == context.tenant_id)
            & (BusinessGatewayIdempotencyRecord.subject == context.subject)
            & (BusinessGatewayIdempotencyRecord.operation == capability.operation)
            & (BusinessGatewayIdempotencyRecord.key_hash == key_hash)
        )
        if existing is None:
            raise BusinessGatewayError(
                "IDEMPOTENCY_UNAVAILABLE",
                "The idempotency record could not be resolved.",
                status=503,
                request_id=context.request_id,
                retryable=True,
            )
        if existing.request_hash != fingerprint:
            raise BusinessGatewayError(
                "IDEMPOTENCY_CONFLICT",
                "The Idempotency-Key was already used with a different request.",
                status=409,
                request_id=context.request_id,
            )
        if existing.state == "reserved" and existing.expires_at <= now:
            reclaimed = (
                BusinessGatewayIdempotencyRecord.update(expires_at=now + RESERVATION_LEASE)
                .where((BusinessGatewayIdempotencyRecord.id == existing.id) & (BusinessGatewayIdempotencyRecord.state == "reserved") & (BusinessGatewayIdempotencyRecord.expires_at <= now))
                .execute()
            )
            if reclaimed == 1:
                return IdempotencyReservation(existing.id, key_hash, lookup_hash=lookup_hash, authorization_hash=authorization_hash)
        if existing.state in {"executing", "uncertain"}:
            intent = BusinessGatewayExecutionIntent.get_or_none(BusinessGatewayExecutionIntent.id == existing.id)
            if existing.state == "executing" and intent is not None and intent.recover_after > now:
                raise BusinessGatewayError(
                    "IDEMPOTENCY_IN_PROGRESS",
                    "A request with this Idempotency-Key is still within its execution lease.",
                    status=409,
                    request_id=context.request_id,
                    retryable=True,
                )
            return IdempotencyReservation(
                existing.id,
                key_hash,
                execution_started=True,
                recovery_required=True,
                lookup_hash=lookup_hash,
                authorization_hash=authorization_hash,
            )
        if existing.state != "completed" or existing.response_status is None or existing.response_body is None:
            raise BusinessGatewayError(
                "IDEMPOTENCY_IN_PROGRESS",
                "A request with this Idempotency-Key is already in progress.",
                status=409,
                request_id=context.request_id,
                retryable=True,
            )
        try:
            body = json.loads(existing.response_body)
        except json.JSONDecodeError as error:
            raise BusinessGatewayError(
                "IDEMPOTENCY_UNAVAILABLE",
                "The stored idempotent response is invalid.",
                status=503,
                request_id=context.request_id,
                retryable=True,
            ) from error
        return IdempotencyReservation(
            existing.id,
            key_hash,
            IdempotencyReplay(existing.response_status, body, existing.response_headers or {}),
            lookup_hash=lookup_hash,
            authorization_hash=authorization_hash,
        )


def mark_executing(
    reservation: IdempotencyReservation,
    plan: RecoveryPlan | None = None,
) -> IdempotencyReservation:
    """Cross the no-automatic-retry boundary immediately before side effects."""
    if reservation.record_id is None or reservation.replay is not None:
        return reservation
    expires_at = _utc_now() + IDEMPOTENCY_TTL
    recovery_plan = plan or RecoveryPlan()
    descriptor = json.loads(json.dumps(recovery_plan.descriptor, ensure_ascii=False, default=str))
    if len(json.dumps(descriptor, ensure_ascii=False, separators=(",", ":"))) > 64 * 1024:
        raise BusinessGatewayError(
            "IDEMPOTENCY_UNAVAILABLE",
            "The recovery descriptor exceeds the durable safety limit.",
            status=503,
            retryable=False,
        )
    with DB.atomic():
        BusinessGatewayExecutionIntent.create(
            id=reservation.record_id,
            operation=BusinessGatewayIdempotencyRecord.get_by_id(reservation.record_id).operation,
            lookup_hash=reservation.lookup_hash or "",
            authorization_hash=reservation.authorization_hash or "",
            strategy=recovery_plan.strategy,
            descriptor=descriptor,
            state="executing",
            recover_after=_utc_now() + EXECUTION_RECOVERY_LEASE,
            expires_at=expires_at,
        )
        updated = (
            BusinessGatewayIdempotencyRecord.update(state="executing", expires_at=expires_at)
            .where((BusinessGatewayIdempotencyRecord.id == reservation.record_id) & (BusinessGatewayIdempotencyRecord.state == "reserved"))
            .execute()
        )
    if updated != 1:
        raise BusinessGatewayError(
            "IDEMPOTENCY_UNAVAILABLE",
            "The idempotent execution lease could not be acquired.",
            status=503,
            retryable=True,
        )
    return IdempotencyReservation(
        reservation.record_id,
        reservation.key_hash,
        execution_started=True,
        lookup_hash=reservation.lookup_hash,
        authorization_hash=reservation.authorization_hash,
    )


def complete(
    reservation: IdempotencyReservation,
    status: int,
    body: dict[str, Any],
    headers: dict[str, str] | None = None,
) -> None:
    if reservation.record_id is None or reservation.replay is not None:
        return
    with DB.atomic():
        updated = (
            BusinessGatewayIdempotencyRecord.update(
                state="completed",
                response_status=status,
                response_body=json.dumps(body, ensure_ascii=False, separators=(",", ":"), default=str),
                response_headers=headers or {},
            )
            .where((BusinessGatewayIdempotencyRecord.id == reservation.record_id) & (BusinessGatewayIdempotencyRecord.state.in_(["reserved", "executing"])))
            .execute()
        )
        intent_updated = BusinessGatewayExecutionIntent.update(state="completed", expires_at=_utc_now() + IDEMPOTENCY_TTL).where(BusinessGatewayExecutionIntent.id == reservation.record_id).execute()
        if updated != 1 or (reservation.execution_started and intent_updated != 1):
            raise BusinessGatewayError(
                "IDEMPOTENCY_OUTCOME_UNKNOWN",
                "The durable idempotency result could not be committed; an administrator must reconcile it.",
                status=503,
                retryable=False,
            )


def complete_recovered(
    reservation: IdempotencyReservation,
    status: int,
    body: dict[str, Any],
    headers: dict[str, str] | None = None,
) -> None:
    """CAS an unknown execution to completed after an authoritative effect probe."""

    if reservation.record_id is None or not reservation.recovery_required:
        raise BusinessGatewayError("IDEMPOTENCY_UNAVAILABLE", "No recoverable execution was selected.", status=503, retryable=False)
    with DB.atomic():
        updated = (
            BusinessGatewayIdempotencyRecord.update(
                state="completed",
                response_status=status,
                response_body=json.dumps(body, ensure_ascii=False, separators=(",", ":"), default=str),
                response_headers=headers or {},
                expires_at=_utc_now() + IDEMPOTENCY_TTL,
            )
            .where((BusinessGatewayIdempotencyRecord.id == reservation.record_id) & (BusinessGatewayIdempotencyRecord.state.in_(["executing", "uncertain"])))
            .execute()
        )
        intent_updated = (
            BusinessGatewayExecutionIntent.update(
                state="recovered",
                attempts=BusinessGatewayExecutionIntent.attempts + 1,
                last_error=None,
                expires_at=_utc_now() + IDEMPOTENCY_TTL,
            )
            .where((BusinessGatewayExecutionIntent.id == reservation.record_id) & (BusinessGatewayExecutionIntent.state.in_(["executing", "uncertain"])))
            .execute()
        )
        if updated != 1 or intent_updated != 1:
            raise BusinessGatewayError(
                "IDEMPOTENCY_OUTCOME_UNKNOWN",
                "The recovered result could not be committed safely.",
                status=503,
                retryable=False,
            )


def abandon(reservation: IdempotencyReservation) -> None:
    if reservation.record_id is None or reservation.replay is not None:
        return
    with DB.atomic():
        BusinessGatewayExecutionIntent.delete().where(BusinessGatewayExecutionIntent.id == reservation.record_id).execute()
        BusinessGatewayIdempotencyRecord.delete().where(
            (BusinessGatewayIdempotencyRecord.id == reservation.record_id) & (BusinessGatewayIdempotencyRecord.state.in_(["reserved", "executing"]))
        ).execute()


def mark_uncertain(reservation: IdempotencyReservation) -> None:
    if reservation.record_id is None or reservation.replay is not None or not reservation.execution_started:
        return
    BusinessGatewayIdempotencyRecord.update(state="uncertain", expires_at=_utc_now() + IDEMPOTENCY_TTL).where(
        (BusinessGatewayIdempotencyRecord.id == reservation.record_id) & (BusinessGatewayIdempotencyRecord.state == "executing")
    ).execute()
    BusinessGatewayExecutionIntent.update(state="uncertain", expires_at=_utc_now() + IDEMPOTENCY_TTL).where(
        (BusinessGatewayExecutionIntent.id == reservation.record_id) & (BusinessGatewayExecutionIntent.state == "executing")
    ).execute()


def execution_intent(reservation: IdempotencyReservation) -> RecoveryPlan:
    if reservation.record_id is None:
        return RecoveryPlan()
    intent = BusinessGatewayExecutionIntent.get_or_none(BusinessGatewayExecutionIntent.id == reservation.record_id)
    if intent is None:
        return RecoveryPlan()
    return RecoveryPlan(str(intent.strategy), dict(intent.descriptor or {}))


def note_recovery_failure(reservation: IdempotencyReservation, reason: str) -> None:
    if reservation.record_id is None:
        return
    BusinessGatewayExecutionIntent.update(
        state="uncertain",
        attempts=BusinessGatewayExecutionIntent.attempts + 1,
        last_error=reason[:64],
        expires_at=_utc_now() + IDEMPOTENCY_TTL,
    ).where((BusinessGatewayExecutionIntent.id == reservation.record_id) & (BusinessGatewayExecutionIntent.state.in_(["executing", "uncertain"]))).execute()


def cleanup_expired(now: datetime | None = None) -> int:
    cutoff = now or _utc_now()
    removable = BusinessGatewayIdempotencyRecord.select(BusinessGatewayIdempotencyRecord.id).where(
        (BusinessGatewayIdempotencyRecord.expires_at <= cutoff) & (BusinessGatewayIdempotencyRecord.state.in_(["reserved", "completed"]))
    )
    with DB.atomic():
        BusinessGatewayExecutionIntent.delete().where(BusinessGatewayExecutionIntent.id.in_(removable)).execute()
        return (
            BusinessGatewayIdempotencyRecord.delete().where((BusinessGatewayIdempotencyRecord.expires_at <= cutoff) & (BusinessGatewayIdempotencyRecord.state.in_(["reserved", "completed"]))).execute()
        )
