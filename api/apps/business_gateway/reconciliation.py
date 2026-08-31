#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Safe operator reconciliation for idempotent executions with unknown outcomes."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from api.db.db_models import DB

from .models import BusinessGatewayExecutionIntent, BusinessGatewayIdempotencyRecord

ReconciliationOutcome = Literal["applied", "not-applied"]


class IdempotencyReconciliationError(RuntimeError):
    """An administrator supplied an unsafe or stale reconciliation request."""


@dataclass(frozen=True)
class ReconciliationPlan:
    record_id: str
    operation: str
    request_hash: str
    previous_state: str
    outcome: ReconciliationOutcome
    response_status: int | None
    dry_run: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "recordId": self.record_id,
            "operation": self.operation,
            "requestHash": self.request_hash,
            "previousState": self.previous_state,
            "outcome": self.outcome,
            "responseStatus": self.response_status,
            "dryRun": self.dry_run,
        }


def action_required_records() -> list[dict[str, Any]]:
    """Return credential-free operator records in deterministic age order."""

    rows = (
        BusinessGatewayIdempotencyRecord.select()
        .where(BusinessGatewayIdempotencyRecord.state.in_(["executing", "uncertain"]))
        .order_by(
            BusinessGatewayIdempotencyRecord.update_time.asc(),
            BusinessGatewayIdempotencyRecord.id.asc(),
        )
    )
    result = []
    for row in rows:
        intent = BusinessGatewayExecutionIntent.get_or_none(BusinessGatewayExecutionIntent.id == row.id)
        result.append(
            {
                "recordId": str(row.id),
                "tenantId": str(row.tenant_id),
                "subject": str(row.subject),
                "operation": str(row.operation),
                "state": str(row.state),
                "requestHash": str(row.request_hash),
                "updatedAt": int(row.update_time) if row.update_time is not None else None,
                "expiresAt": _iso(row.expires_at),
                "recoveryStrategy": str(intent.strategy) if intent is not None else "manual",
                "recoveryAttempts": int(intent.attempts) if intent is not None else 0,
                "lastRecoveryError": str(intent.last_error) if intent is not None and intent.last_error else None,
                "recoveryTargets": _public_recovery_targets(getattr(intent, "descriptor", {}) if intent is not None else {}),
            }
        )
    return result


def reconcile_idempotency(
    record_id: str,
    *,
    expected_operation: str,
    expected_request_hash: str,
    outcome: ReconciliationOutcome,
    response_status: int | None = None,
    response_body: dict[str, Any] | None = None,
    dry_run: bool = False,
    now: datetime | None = None,
) -> ReconciliationPlan:
    """Validate and conditionally apply one explicit operator decision.

    The compare-and-set state predicate prevents a stale terminal or concurrent
    decision from being overwritten after the administrator inspected it.
    """

    normalized_id = record_id.strip()
    normalized_operation = expected_operation.strip()
    normalized_request_hash = expected_request_hash.strip().lower()
    if not normalized_id or not normalized_operation or not normalized_request_hash:
        raise IdempotencyReconciliationError("record-id, expected-operation, and expected-request-hash must be non-empty")
    if len(normalized_request_hash) != 64 or any(character not in "0123456789abcdef" for character in normalized_request_hash):
        raise IdempotencyReconciliationError("expected-request-hash must be a lowercase SHA-256 value")
    if outcome not in {"applied", "not-applied"}:
        raise IdempotencyReconciliationError("outcome must be applied or not-applied")
    if outcome == "applied":
        _validate_applied_response(response_status, response_body)
    elif response_status is not None or response_body is not None:
        raise IdempotencyReconciliationError("not-applied does not accept a response")

    with DB.atomic():
        record = BusinessGatewayIdempotencyRecord.get_or_none(BusinessGatewayIdempotencyRecord.id == normalized_id)
        if record is None or record.state not in {"executing", "uncertain"}:
            raise IdempotencyReconciliationError("an executing or uncertain idempotency record was not found")
        if record.operation != normalized_operation:
            raise IdempotencyReconciliationError("expected-operation does not match the selected idempotency record")
        if record.request_hash != normalized_request_hash:
            raise IdempotencyReconciliationError("expected-request-hash does not match the selected idempotency record")

        plan = ReconciliationPlan(
            record_id=normalized_id,
            operation=str(record.operation),
            request_hash=str(record.request_hash),
            previous_state=str(record.state),
            outcome=outcome,
            response_status=response_status,
            dry_run=dry_run,
        )
        if dry_run:
            return plan

        state_guard = (
            (BusinessGatewayIdempotencyRecord.id == normalized_id)
            & (BusinessGatewayIdempotencyRecord.operation == normalized_operation)
            & (BusinessGatewayIdempotencyRecord.request_hash == normalized_request_hash)
            & (BusinessGatewayIdempotencyRecord.state == record.state)
        )
        if outcome == "not-applied":
            BusinessGatewayExecutionIntent.delete().where(BusinessGatewayExecutionIntent.id == normalized_id).execute()
            changed = BusinessGatewayIdempotencyRecord.delete().where(state_guard).execute()
        else:
            changed = (
                BusinessGatewayIdempotencyRecord.update(
                    state="completed",
                    response_status=response_status,
                    response_body=json.dumps(response_body, ensure_ascii=False, separators=(",", ":")),
                    response_headers={"Cache-Control": "no-store"},
                    expires_at=(now or datetime.now(UTC)).replace(tzinfo=None) + timedelta(hours=24),
                )
                .where(state_guard)
                .execute()
            )
            BusinessGatewayExecutionIntent.update(
                state="operator-reconciled",
                expires_at=(now or datetime.now(UTC)).replace(tzinfo=None) + timedelta(hours=24),
            ).where(BusinessGatewayExecutionIntent.id == normalized_id).execute()
        if changed != 1:
            raise IdempotencyReconciliationError("the idempotency record changed while it was being reconciled")
        return plan


def _validate_applied_response(status: int | None, body: dict[str, Any] | None) -> None:
    if status is None or status < 200 or status > 299:
        raise IdempotencyReconciliationError("applied requires a 2xx response-status")
    if not isinstance(body, dict) or set(body) != {"data", "meta"} or not isinstance(body["meta"], dict):
        raise IdempotencyReconciliationError("applied requires a {data,meta} Business Gateway response envelope")
    request_id = body["meta"].get("requestId")
    if not isinstance(request_id, str) or not request_id.strip():
        raise IdempotencyReconciliationError("the reconciled response meta.requestId must be a non-empty string")


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or UTC).isoformat()
    return str(value)


def _public_recovery_targets(descriptor: Any) -> dict[str, Any]:
    """Expose resource IDs needed by operators without leaking storage locations."""

    if not isinstance(descriptor, dict):
        return {}
    result = {}
    for key in ("resourceId", "chunkId", "datasetId", "documentId"):
        value = descriptor.get(key)
        if isinstance(value, str) and value:
            result[key] = value
    if isinstance(descriptor.get("ids"), list):
        result["ids"] = [str(value) for value in descriptor["ids"]]
    for key in ("datasets", "documents"):
        values = descriptor.get(key)
        if isinstance(values, list):
            result[key] = [{name: str(item[name]) for name in ("id", "datasetId") if isinstance(item, dict) and item.get(name) is not None} for item in values if isinstance(item, dict)]
    return result


__all__ = [
    "IdempotencyReconciliationError",
    "ReconciliationPlan",
    "action_required_records",
    "reconcile_idempotency",
]
