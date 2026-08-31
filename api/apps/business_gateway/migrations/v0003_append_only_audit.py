"""Install database-enforced append-only guards for audit events."""


def apply(database, _models) -> None:
    table = "business_gateway_audit_event"
    database_name = type(database).__name__.lower()
    if "mysql" in database_name or "oceanbase" in database_name:
        for event in ("UPDATE", "DELETE"):
            trigger = f"{table}_deny_{event.lower()}"
            cursor = database.execute_sql(
                "SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = %s",
                (trigger,),
            )
            if cursor.fetchone() is None:
                database.execute_sql(f"CREATE TRIGGER `{trigger}` BEFORE {event} ON `{table}` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Business Gateway audit events are append-only'")
        return
    if "postgres" not in database_name and "gauss" not in database_name:
        return

    function = f"{table}_append_only_guard"
    database.execute_sql(
        f"CREATE OR REPLACE FUNCTION \"{function}\"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Business Gateway audit events are append-only' USING ERRCODE = '55000'; END; $$ LANGUAGE plpgsql"
    )
    for event in ("UPDATE", "DELETE"):
        trigger = f"{table}_deny_{event.lower()}"
        database.execute_sql(f'DROP TRIGGER IF EXISTS "{trigger}" ON "{table}"')
        database.execute_sql(f'CREATE TRIGGER "{trigger}" BEFORE {event} ON "{table}" FOR EACH ROW EXECUTE FUNCTION "{function}"()')
