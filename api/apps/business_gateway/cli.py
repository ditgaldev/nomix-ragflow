#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

"""Administrator-only commands for the Business Gateway integration plane."""

from __future__ import annotations

import json

import click

from api.db.db_models import Tenant, User, UserTenant
from common.constants import StatusEnum
from common.misc_utils import get_uuid

from .idempotency import cleanup_expired
from .migration import business_gateway_schema_status, migrate_business_gateway_schema
from .models import BusinessGatewayWorkspaceBinding
from .reconciliation import IdempotencyReconciliationError, action_required_records, reconcile_idempotency


@click.group("business-gateway", help="Administer Business Gateway workspace mappings and idempotency records.")
def business_gateway_commands():
    pass


@business_gateway_commands.command("bind-workspace")
@click.option("--authority", required=True, help="Token authority identifier used by introspection.")
@click.option("--workspace-id", required=True, help="Business workspace identifier.")
@click.option("--tenant-id", required=True, help="Mapped RAGFlow tenant identifier.")
@click.option("--execution-user-id", required=True, help="Existing RAGFlow user used for ACL evaluation.")
@click.option("--active/--inactive", default=True)
def bind_business_workspace(authority, workspace_id, tenant_id, execution_user_id, active):
    tenant = Tenant.get_or_none(Tenant.id == tenant_id)
    if tenant is None or tenant.status != StatusEnum.VALID.value:
        raise click.ClickException("tenant-id does not identify an existing RAGFlow tenant")
    tenant_principal = User.get_or_none(User.id == tenant_id)
    if tenant_principal is None or tenant_principal.is_active != StatusEnum.VALID.value or tenant_principal.status != StatusEnum.VALID.value:
        raise click.ClickException("tenant-id does not have an active RAGFlow service principal")
    execution_user = User.get_or_none(User.id == execution_user_id)
    if execution_user is None or execution_user.is_active != StatusEnum.VALID.value or execution_user.status != StatusEnum.VALID.value:
        raise click.ClickException("execution-user-id does not identify an existing RAGFlow user")
    relation = (
        execution_user_id == tenant_id
        or UserTenant.get_or_none((UserTenant.user_id == execution_user_id) & (UserTenant.tenant_id == tenant_id) & (UserTenant.status == StatusEnum.VALID.value)) is not None
    )
    if not relation:
        raise click.ClickException("execution-user-id is not an active member of tenant-id")
    existing = BusinessGatewayWorkspaceBinding.get_or_none((BusinessGatewayWorkspaceBinding.authority == authority) & (BusinessGatewayWorkspaceBinding.workspace_id == workspace_id))
    if active:
        existing_id = existing.id if existing is not None else ""
        base = (BusinessGatewayWorkspaceBinding.active == 1) & (BusinessGatewayWorkspaceBinding.id != existing_id)
        tenant_conflict = BusinessGatewayWorkspaceBinding.get_or_none(base & (BusinessGatewayWorkspaceBinding.tenant_id == tenant_id))
        execution_conflict = BusinessGatewayWorkspaceBinding.get_or_none(base & (BusinessGatewayWorkspaceBinding.execution_user_id == execution_user_id))
        if tenant_conflict is not None or execution_conflict is not None:
            raise click.ClickException("an active Business Gateway workspace already uses this tenant-id or execution-user-id; v1 mappings must be one-to-one")
    values = {
        "tenant_id": tenant_id,
        "execution_user_id": execution_user_id,
        "active": active,
    }
    if existing is None:
        BusinessGatewayWorkspaceBinding.create(
            id=get_uuid(),
            authority=authority,
            workspace_id=workspace_id,
            **values,
        )
    else:
        BusinessGatewayWorkspaceBinding.update(**values).where(BusinessGatewayWorkspaceBinding.id == existing.id).execute()
    click.echo(f"workspace {workspace_id} is {'active' if active else 'inactive'}")


@business_gateway_commands.command("cleanup-idempotency")
def cleanup_business_idempotency():
    click.echo(f"removed {cleanup_expired()} expired idempotency record(s)")


@business_gateway_commands.command("list-uncertain-idempotency")
@click.option("--json-output", is_flag=True, help="Emit a machine-readable credential-free reconciliation queue.")
def list_uncertain_business_idempotency(json_output):
    rows = action_required_records()
    if json_output:
        click.echo(json.dumps({"records": rows}, ensure_ascii=False, separators=(",", ":")))
        return
    for row in rows:
        click.echo(f"{row['recordId']}\t{row['tenantId']}\t{row['subject']}\t{row['operation']}\t{row['state']}\t{row['requestHash']}")


@business_gateway_commands.command("reconcile-idempotency")
@click.option("--record-id", required=True)
@click.option("--expected-operation", required=True, help="Must match the inspected record before any mutation occurs.")
@click.option(
    "--expected-request-hash",
    required=True,
    help="Must match the inspected request SHA-256 before any mutation occurs.",
)
@click.option("--outcome", required=True, type=click.Choice(["applied", "not-applied"], case_sensitive=True))
@click.option("--response-status", type=click.IntRange(200, 299))
@click.option("--response-json", help="Required JSON response envelope when outcome=applied.")
@click.option("--dry-run", is_flag=True, help="Validate the decision and record identity without changing the database.")
def reconcile_business_idempotency(
    record_id,
    expected_operation,
    expected_request_hash,
    outcome,
    response_status,
    response_json,
    dry_run,
):
    body = None
    if response_json is not None:
        try:
            body = json.loads(response_json)
        except json.JSONDecodeError as error:
            raise click.ClickException("--response-json must be valid JSON") from error
    try:
        plan = reconcile_idempotency(
            record_id,
            expected_operation=expected_operation,
            expected_request_hash=expected_request_hash,
            outcome=outcome,
            response_status=response_status,
            response_body=body,
            dry_run=dry_run,
        )
    except IdempotencyReconciliationError as error:
        raise click.ClickException(str(error)) from error
    click.echo(json.dumps(plan.to_dict(), separators=(",", ":")))


@business_gateway_commands.command("migrate")
def migrate_business_gateway():
    """Apply the idempotent, forward-only Business Gateway v1 schema."""

    tables = migrate_business_gateway_schema()
    click.echo(f"Business Gateway schema is ready ({', '.join(tables)})")


@business_gateway_commands.command("migration-status")
def business_gateway_migration_status():
    """Report migration readiness without changing the database."""

    status = business_gateway_schema_status()
    click.echo(
        json.dumps(
            {
                "ready": status.ready,
                "applied": list(status.applied),
                "pending": list(status.pending),
                "error": status.error,
            },
            separators=(",", ":"),
        )
    )
    if not status.ready:
        raise click.ClickException("Business Gateway schema is not ready")


def register_business_gateway_commands(app) -> None:
    app.cli.add_command(business_gateway_commands)


__all__ = ["business_gateway_commands", "register_business_gateway_commands"]
