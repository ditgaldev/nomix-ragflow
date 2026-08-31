"""Remove the superseded local grant table; authorization stays external."""


def apply(database, _models) -> None:
    database.execute_sql("DROP TABLE IF EXISTS business_gateway_resource_grant")
