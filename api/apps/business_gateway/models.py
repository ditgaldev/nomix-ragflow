#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Persistence owned exclusively by the Business Gateway integration plane."""

from __future__ import annotations

from peewee import BooleanField, CharField, DateTimeField, IntegerField

from api.db.db_models import DataBaseModel, JSONField, LongTextField


class BusinessGatewayWorkspaceBinding(DataBaseModel):
    """Server-owned mapping from a business workspace to a RAGFlow principal."""

    id = CharField(max_length=32, primary_key=True)
    authority = CharField(max_length=255, null=False, index=True)
    workspace_id = CharField(max_length=255, null=False, index=True)
    tenant_id = CharField(max_length=32, null=False, index=True)
    execution_user_id = CharField(max_length=32, null=False, index=True)
    active = BooleanField(null=False, default=True, index=True)

    class Meta:
        db_table = "business_gateway_workspace_binding"
        indexes = ((("authority", "workspace_id"), True),)


class BusinessGatewayIdempotencyRecord(DataBaseModel):
    """Durable, credential-free result cache for Business Gateway writes."""

    id = CharField(max_length=32, primary_key=True)
    tenant_id = CharField(max_length=32, null=False, index=True)
    subject = CharField(max_length=255, null=False, index=True)
    operation = CharField(max_length=128, null=False, index=True)
    key_hash = CharField(max_length=64, null=False, index=True)
    request_hash = CharField(max_length=64, null=False)
    state = CharField(max_length=16, null=False, default="reserved", index=True)
    response_status = IntegerField(null=True)
    response_body = LongTextField(null=True)
    response_headers = JSONField(null=True, default={})
    expires_at = DateTimeField(null=False, index=True)

    class Meta:
        db_table = "business_gateway_idempotency"
        indexes = ((("tenant_id", "subject", "operation", "key_hash"), True),)


class BusinessGatewayExecutionIntent(DataBaseModel):
    """Write-ahead recovery descriptor for one idempotent external side effect."""

    id = CharField(max_length=32, primary_key=True)
    operation = CharField(max_length=128, null=False, index=True)
    lookup_hash = CharField(max_length=64, null=False, index=True)
    authorization_hash = CharField(max_length=64, null=False, index=True)
    strategy = CharField(max_length=32, null=False, default="manual", index=True)
    descriptor = JSONField(null=False, default={})
    state = CharField(max_length=24, null=False, default="prepared", index=True)
    attempts = IntegerField(null=False, default=0)
    last_error = CharField(max_length=64, null=True)
    recover_after = DateTimeField(null=False, index=True)
    expires_at = DateTimeField(null=False, index=True)

    class Meta:
        db_table = "business_gateway_execution_intent"
        indexes = ((("lookup_hash", "authorization_hash", "operation"), False),)


class BusinessGatewayAuditEvent(DataBaseModel):
    """Append-only Business Gateway audit event; tokens are never persisted."""

    id = CharField(max_length=32, primary_key=True)
    request_id = CharField(max_length=64, null=False, index=True)
    subject = CharField(max_length=255, null=False, index=True)
    actor_subject = CharField(max_length=255, null=False, index=True)
    on_behalf_of_subject = CharField(max_length=255, null=True, index=True)
    workspace_id = CharField(max_length=255, null=False, index=True)
    tenant_id = CharField(max_length=32, null=False, index=True)
    permission_ref = CharField(max_length=255, null=True, index=True)
    authentication_type = CharField(max_length=32, null=False)
    entry_point = CharField(max_length=16, null=False, default="rest", index=True)
    operation = CharField(max_length=128, null=False, index=True)
    action = CharField(max_length=128, null=False, index=True)
    resource_type = CharField(max_length=32, null=False, index=True)
    resource_ids = JSONField(null=True, default={})
    outcome = CharField(max_length=32, null=False, index=True)
    http_status = IntegerField(null=False, index=True)
    idempotency_key_hash = CharField(max_length=64, null=True, index=True)
    token_fingerprint = CharField(max_length=64, null=False, index=True)
    duration_ms = IntegerField(null=False, default=0)
    details = JSONField(null=True, default={})

    class Meta:
        db_table = "business_gateway_audit_event"


class BusinessGatewaySchemaMigration(DataBaseModel):
    """Immutable ledger for forward-only Business Gateway migrations."""

    name = CharField(max_length=128, primary_key=True)
    checksum = CharField(max_length=64, null=False)

    class Meta:
        db_table = "business_gateway_schema_migration"


__all__ = [
    "BusinessGatewayAuditEvent",
    "BusinessGatewayExecutionIntent",
    "BusinessGatewayIdempotencyRecord",
    "BusinessGatewaySchemaMigration",
    "BusinessGatewayWorkspaceBinding",
]
