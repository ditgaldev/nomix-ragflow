"""Add the Gateway write-ahead execution-intent journal."""


def apply(database, models) -> None:
    intent = next(model for model in models if model._meta.table_name == "business_gateway_execution_intent")
    database.create_tables([intent], safe=True)
