#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import asyncio
import hashlib
import logging
from time import perf_counter
from typing import Any

from quart import Blueprint, Response, current_app, jsonify, request
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from api.db.db_models import DB
from common.time_utils import current_timestamp

from .adapter import RagFlowBusinessServiceAdapter
from .audit import append_audit_event, append_authentication_failure
from .auth import authenticate_business_request
from .capabilities import MAX_PAGE_LIMIT, Capability, capabilities, manifest, requires_resource_version
from .concurrency import requires_mutation_lock
from .config import BusinessGatewaySettings
from .contracts import validate_request
from .errors import BusinessGatewayError, error_response
from .idempotency import (
    abandon,
    complete,
    complete_recovered,
    execution_intent,
    lookup_existing_for_recovery,
    mark_executing,
    mark_uncertain,
    note_recovery_failure,
    request_fingerprint,
    reserve,
)
from .introspection import TokenIntrospector
from .openapi import build_openapi
from .policy import AuthorizationPolicy
from .readiness import readiness_status
from .recovery import RecoveryPlan
from .telemetry import BusinessGatewayTelemetry
from .types import PreparedAuthorization, RagFlowExecutionContext

business_gateway = Blueprint("business_gateway", __name__)
logger = logging.getLogger(__name__)


@business_gateway.get("/health")
async def health():
    return jsonify({"status": "ok", "service": "nomix-ragflow", "standardVersion": "v1"})


@business_gateway.get("/ready")
async def ready():
    ready_state, checks = await readiness_status(current_app)
    response = jsonify(
        {
            "status": "ready" if ready_state else "not-ready",
            "service": "nomix-ragflow",
            "standardVersion": "v1",
            "checks": checks,
        }
    )
    response.status_code = 200 if ready_state else 503
    response.headers["Cache-Control"] = "no-store"
    return response


@business_gateway.get("/_metrics")
async def metrics():
    telemetry: BusinessGatewayTelemetry = current_app.extensions["business_gateway_telemetry"]
    try:
        from .models import BusinessGatewayIdempotencyRecord

        uncertain = BusinessGatewayIdempotencyRecord.select().where(BusinessGatewayIdempotencyRecord.state == "uncertain").count()
        stale_executing = (
            BusinessGatewayIdempotencyRecord.select()
            .where((BusinessGatewayIdempotencyRecord.state == "executing") & (BusinessGatewayIdempotencyRecord.update_time < current_timestamp() - 30 * 60 * 1000))
            .count()
        )
    except Exception:  # noqa: BLE001 - metrics must remain available without exposing database details
        telemetry.observe_failure("metrics", "idempotency-query")
        uncertain = -1
        stale_executing = -1
    return Response(telemetry.render_prometheus(uncertain, stale_executing), content_type="text/plain; version=0.0.4; charset=utf-8")


@business_gateway.get("/capabilities")
async def capability_manifest():
    return jsonify(manifest())


@business_gateway.get("/openapi.json")
async def openapi_document():
    return jsonify(build_openapi())


def register_capability_routes() -> None:
    for capability in capabilities():
        endpoint = "operation_" + capability.operation.replace(".", "_")

        async def view(_capability: Capability = capability, **path_args):
            return await _execute(_capability, path_args)

        business_gateway.add_url_rule(
            capability.quart_path,
            endpoint=endpoint,
            view_func=view,
            methods=[capability.method],
        )


async def _execute(capability: Capability, path_args: dict[str, Any]):
    started = perf_counter()
    context: RagFlowExecutionContext | None = None
    prepared: PreparedAuthorization | None = None
    reservation = None
    concurrency_lease = None
    telemetry_status = 500
    telemetry_outcome = "failed"
    try:
        introspector: TokenIntrospector = current_app.extensions["business_gateway_introspector"]
        adapter: RagFlowBusinessServiceAdapter = current_app.extensions["business_gateway_adapter"]
        context = await authenticate_business_request(request, introspector)
        payload, fingerprint_payload = await _payload()
        if capability.operation.endswith(".invoke") and payload and payload.get("stream") is True:
            raise BusinessGatewayError(
                "STREAMING_NOT_IDEMPOTENT",
                "Streaming invoke is not available on Business Gateway v1; use a cancellable non-streaming invoke.",
                status=400,
                request_id=context.request_id,
            )
        query = _query()
        if "limit" in query:
            query["limit"] = _limit(query)
        validate_request(capability.operation, payload, query)
        policy = AuthorizationPolicy(context)
        fingerprint = request_fingerprint(
            capability,
            path_args,
            query,
            {"payload": fingerprint_payload, "ifMatch": request.headers.get("If-Match")},
        )
        try:
            prepared = policy.prepare(capability, path_args, payload, query)
        except BusinessGatewayError as policy_error:
            if policy_error.status != 404:
                raise
            reservation = lookup_existing_for_recovery(
                capability,
                context,
                request.headers.get("Idempotency-Key"),
                fingerprint,
            )
            if reservation is None:
                raise
            prepared = policy.prepare_recovery(
                capability,
                path_args,
                payload,
                query,
                execution_intent(reservation),
            )
        if prepared.authorization_seal is None:
            raise RuntimeError("Business Gateway policy returned without an authorization seal")
        if reservation is None:
            reservation = reserve(
                capability,
                context,
                request.headers.get("Idempotency-Key"),
                fingerprint,
                prepared.authorization_seal.scope_hash,
            )

        if reservation.recovery_required:
            if requires_resource_version(capability.operation) or requires_mutation_lock(capability.operation):
                concurrency = current_app.extensions["business_gateway_concurrency"]
                concurrency_lease = await concurrency.acquire_recovery(capability, context, prepared)
            recover = getattr(adapter, "recover", None)
            outcome = await recover(capability, context, prepared, execution_intent(reservation)) if callable(recover) else None
            if outcome is None or outcome.decision != "applied":
                note_recovery_failure(reservation, "effect-not-proven")
                raise BusinessGatewayError(
                    "IDEMPOTENCY_OUTCOME_UNKNOWN",
                    "The previous execution could not be proven or converged automatically; administrator reconciliation is required.",
                    status=503,
                    request_id=context.request_id,
                    retryable=False,
                )
            recovered_meta = dict(outcome.meta)
            recovered_meta["requestId"] = context.request_id
            recovered_body = {"data": outcome.data, "meta": recovered_meta}
            with DB.atomic():
                complete_recovered(reservation, outcome.status, recovered_body, {"Cache-Control": "no-store"})
                _append_audit_event(
                    context,
                    capability,
                    prepared,
                    status=outcome.status,
                    outcome="recovered",
                    duration_ms=_duration_ms(started),
                    idempotency_key_hash=reservation.key_hash,
                )
            response = jsonify(recovered_body)
            response.status_code = outcome.status
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Idempotent-Replay"] = "true"
            response.headers["X-Idempotency-Recovered"] = "true"
            response.headers["X-Request-Id"] = context.request_id
            telemetry_status = outcome.status
            telemetry_outcome = "recovered"
            return response

        if reservation.replay is not None:
            replay_body = dict(reservation.replay.body)
            replay_meta = replay_body.get("meta")
            if isinstance(replay_meta, dict):
                replay_body["meta"] = {**replay_meta, "requestId": context.request_id}
            response = jsonify(replay_body)
            response.status_code = reservation.replay.status
            for name, value in reservation.replay.headers.items():
                response.headers[name] = value
            response.headers["X-Idempotent-Replay"] = "true"
            response.headers["X-Request-Id"] = context.request_id
            _append_audit_event(
                context,
                capability,
                prepared,
                status=response.status_code,
                outcome="replayed",
                duration_ms=_duration_ms(started),
                idempotency_key_hash=reservation.key_hash,
            )
            telemetry_status = response.status_code
            telemetry_outcome = "replayed"
            return response

        if requires_resource_version(capability.operation):
            concurrency = current_app.extensions["business_gateway_concurrency"]
            concurrency_lease = await concurrency.acquire(
                capability,
                context,
                prepared,
                request.headers.get("If-Match"),
            )
        elif requires_mutation_lock(capability.operation):
            concurrency = current_app.extensions["business_gateway_concurrency"]
            concurrency_lease = await concurrency.acquire_mutation(capability, context, prepared)

        if prepared.has_empty_result:
            data = prepared.empty_result
            page_source = payload if capability.operation == "retrieval.search" and payload is not None else query
            meta = {"limit": _limit(page_source), "hasNext": False, "nextCursor": None}
            status = 200
        else:
            prepare_recovery = getattr(adapter, "prepare_recovery", None)
            recovery_plan = await prepare_recovery(capability, context, prepared, reservation.record_id) if callable(prepare_recovery) else RecoveryPlan()
            reservation = mark_executing(reservation, recovery_plan)
            result = await adapter.invoke(capability, context, prepared)
            if result.passthrough is not None:
                result.passthrough.headers["X-Request-Id"] = context.request_id
                result.passthrough.headers["Cache-Control"] = "no-store"
                _append_audit_event(
                    context,
                    capability,
                    prepared,
                    status=result.passthrough.status_code,
                    outcome="succeeded",
                    duration_ms=_duration_ms(started),
                    idempotency_key_hash=reservation.key_hash,
                )
                telemetry_status = result.passthrough.status_code
                telemetry_outcome = "succeeded"
                return result.passthrough
            data = result.data
            meta = result.meta or {}
            status = _semantic_status(capability)

        meta["requestId"] = context.request_id
        body = {"data": data, "meta": meta}
        response = jsonify(body)
        response.status_code = status
        response.headers["X-Request-Id"] = context.request_id
        response.headers["Cache-Control"] = "no-store"
        if reservation.record_id is not None:
            try:
                with DB.atomic():
                    complete(reservation, status, body, {"Cache-Control": "no-store"})
                    _append_audit_event(
                        context,
                        capability,
                        prepared,
                        status=status,
                        outcome="succeeded",
                        duration_ms=_duration_ms(started),
                        idempotency_key_hash=reservation.key_hash,
                    )
            except BusinessGatewayError:
                raise
            except Exception as error:
                mark_uncertain(reservation)
                _observe_failure("idempotency", "uncertain")
                raise BusinessGatewayError(
                    "IDEMPOTENCY_OUTCOME_UNKNOWN",
                    "The command completed but its durable replay result could not be committed; an administrator must reconcile it.",
                    status=503,
                    request_id=context.request_id,
                    retryable=False,
                ) from error
        else:
            _append_audit_event(
                context,
                capability,
                prepared,
                status=status,
                outcome="succeeded",
                duration_ms=_duration_ms(started),
                idempotency_key_hash=reservation.key_hash,
            )
        telemetry_status = status
        telemetry_outcome = "succeeded"
        return response
    except BusinessGatewayError as error:
        if context is not None:
            error.with_request_id(context.request_id)
        if reservation is not None:
            if reservation.execution_started:
                mark_uncertain(reservation)
                _observe_failure("idempotency", "uncertain")
            else:
                abandon(reservation)
        response = error_response(error)
        telemetry_status = error.status
        telemetry_outcome = "denied" if error.status in {401, 403, 404} else "failed"
        if context is not None:
            try:
                _append_audit_event(
                    context,
                    capability,
                    prepared,
                    status=error.status,
                    outcome="denied" if error.status in {401, 403, 404} else "failed",
                    duration_ms=_duration_ms(started),
                    idempotency_key_hash=getattr(reservation, "key_hash", None),
                    details={"errorCode": error.code},
                )
            except Exception:  # noqa: BLE001 - audit failure must not replace the operation error
                logger.error("Business Gateway audit write failed request_id=%s", context.request_id)
        else:
            try:
                _append_authentication_failure(
                    request.headers.get("Authorization", ""),
                    capability,
                    request_id=error.request_id or "unknown",
                    status=error.status,
                    outcome="denied" if error.status in {400, 401, 403, 404} else "failed",
                    duration_ms=_duration_ms(started),
                    error_code=error.code,
                )
            except Exception:  # noqa: BLE001 - audit failure must not replace the authentication error
                logger.error("Business Gateway authentication audit write failed request_id=%s", error.request_id or "unknown")
        return response
    except Exception as error:  # noqa: BLE001 - public boundary converts unknown failures to a sanitized response
        if reservation is not None:
            mark_uncertain(reservation)
            if reservation.execution_started:
                _observe_failure("idempotency", "uncertain")
            abandon(reservation)
        request_id = context.request_id if context is not None else "unknown"
        logger.error(
            "Business Gateway request failed request_id=%s operation=%s exception=%s",
            request_id,
            capability.operation,
            type(error).__name__,
        )
        gateway_error = BusinessGatewayError(
            "INTERNAL_ERROR",
            "The Business Gateway could not complete the request.",
            status=500,
            request_id=request_id,
            retryable=True,
        )
        if context is not None:
            try:
                _append_audit_event(
                    context,
                    capability,
                    prepared,
                    status=500,
                    outcome="failed",
                    duration_ms=_duration_ms(started),
                    idempotency_key_hash=getattr(reservation, "key_hash", None),
                    details={"exception": type(error).__name__},
                )
            except Exception:  # noqa: BLE001 - audit failure must not replace the operation error
                logger.error("Business Gateway audit write failed request_id=%s", request_id)
        else:
            try:
                _append_authentication_failure(
                    request.headers.get("Authorization", ""),
                    capability,
                    request_id=request_id,
                    status=500,
                    outcome="failed",
                    duration_ms=_duration_ms(started),
                    error_code="INTERNAL_ERROR",
                )
            except Exception:  # noqa: BLE001 - audit failure must not replace the operation error
                logger.error("Business Gateway authentication audit write failed request_id=%s", request_id)
        return error_response(gateway_error)
    finally:
        if concurrency_lease is not None:
            await concurrency_lease.release()
        telemetry = current_app.extensions.get("business_gateway_telemetry")
        if telemetry is not None:
            telemetry.observe_request(
                capability.operation,
                telemetry_outcome,
                telemetry_status,
                _duration_ms(started),
            )


async def _payload() -> tuple[dict[str, Any] | None, Any]:
    if request.method in {"GET", "HEAD"}:
        return None, None
    limit = _request_body_limit()
    if request.content_length is not None and request.content_length > limit:
        raise _request_too_large(limit)
    if request.mimetype == "application/json":
        try:
            raw = await request.get_data()
        except RequestEntityTooLarge as error:
            raise _request_too_large(limit) from error
        if len(raw) > limit:
            raise _request_too_large(limit)
        try:
            value = await request.get_json(silent=False)
        except BadRequest as error:
            raise BusinessGatewayError(
                "INVALID_REQUEST",
                "The JSON request body is malformed.",
                status=400,
            ) from error
        if value is None:
            value = {}
        if not isinstance(value, dict):
            raise BusinessGatewayError(
                "INVALID_REQUEST",
                "The JSON request body must be an object.",
                status=400,
            )
        return value, value
    if request.mimetype and request.mimetype.startswith("multipart/form-data"):
        file_limit = _upload_file_limit()
        try:
            files = await request.files
            form = await request.form
        except RequestEntityTooLarge as error:
            raise _request_too_large(limit) from error
        except BadRequest as error:
            raise BusinessGatewayError(
                "INVALID_REQUEST",
                "The multipart request body is malformed.",
                status=400,
            ) from error
        form_value = form.to_dict(flat=True)
        file_fingerprints = []
        total_size = 0
        for field in files:
            form_value[field] = [item.filename or "" for item in files.getlist(field)]
            for item in files.getlist(field):
                digest, size = await asyncio.to_thread(_file_digest, item.stream, file_limit)
                total_size += size
                if total_size > limit:
                    raise _request_too_large(limit)
                file_fingerprints.append(
                    {
                        "field": field,
                        "filename": item.filename,
                        "contentType": item.content_type,
                        "size": size,
                        "sha256": digest,
                    }
                )
        fingerprint = {
            "form": form_value,
            "files": file_fingerprints,
            "contentLength": request.content_length,
        }
        return form_value, fingerprint
    if request.content_length in {None, 0}:
        return {}, {}
    raise BusinessGatewayError(
        "INVALID_CONTENT_TYPE",
        "Business Gateway requests must use application/json or multipart/form-data.",
        status=415,
    )


def _query() -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in request.args:
        values = request.args.getlist(key)
        result[key] = values if len(values) > 1 else values[0]
    return result


def _limit(query: dict[str, Any]) -> int:
    try:
        value = int(query.get("limit", MAX_PAGE_LIMIT))
    except (TypeError, ValueError):
        raise BusinessGatewayError(
            "INVALID_REQUEST",
            f"limit must be an integer from 1 to {MAX_PAGE_LIMIT}.",
            status=400,
        )
    if value < 1 or value > MAX_PAGE_LIMIT:
        raise BusinessGatewayError(
            "INVALID_REQUEST",
            f"limit must be an integer from 1 to {MAX_PAGE_LIMIT}.",
            status=400,
        )
    return value


def _semantic_status(capability: Capability) -> int:
    if capability.operation.endswith(".create") or capability.operation in {"datasets.create", "documents.upload", "memoryMessages.batchCreate"}:
        return 201
    if capability.operation in {"documents.startParse", "documents.cancelParse"}:
        return 202
    return 200


def _duration_ms(started: float) -> int:
    return round((perf_counter() - started) * 1000)


def _observe_failure(component: str, reason: str) -> None:
    telemetry = current_app.extensions.get("business_gateway_telemetry")
    if telemetry is not None:
        telemetry.observe_failure(component, reason)


def _append_audit_event(*args, **kwargs) -> None:
    try:
        append_audit_event(*args, **kwargs)
    except Exception:
        _observe_failure("audit", "write")
        raise


def _append_authentication_failure(*args, **kwargs) -> None:
    try:
        append_authentication_failure(*args, **kwargs)
    except Exception:
        _observe_failure("audit", "authentication-write")
        raise


def _file_digest(stream, max_bytes: int) -> tuple[str, int]:
    position = stream.tell()
    digest = hashlib.sha256()
    size = 0
    try:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
            if size > max_bytes:
                raise _file_too_large(max_bytes, size)
    finally:
        stream.seek(position)
    return digest.hexdigest(), size


def _request_body_limit() -> int:
    settings: BusinessGatewaySettings = current_app.extensions["business_gateway_settings"]
    return settings.max_request_bytes


def _upload_file_limit() -> int:
    settings: BusinessGatewaySettings = current_app.extensions["business_gateway_settings"]
    return settings.max_file_bytes


def _request_too_large(limit: int) -> BusinessGatewayError:
    return BusinessGatewayError(
        "REQUEST_TOO_LARGE",
        "The Business Gateway request body exceeds the configured limit.",
        status=413,
        details={"maxBytes": limit},
        retryable=False,
    )


def _file_too_large(limit: int, actual: int) -> BusinessGatewayError:
    return BusinessGatewayError(
        "FILE_TOO_LARGE",
        "An uploaded file exceeds the configured single-file limit.",
        status=413,
        details={"maxBytes": limit, "actualBytesAtLeast": actual},
        retryable=False,
    )


register_capability_routes()
