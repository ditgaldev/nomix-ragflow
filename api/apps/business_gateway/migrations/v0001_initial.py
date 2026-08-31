"""Create the Business Gateway-owned data-plane tables."""


def apply(database, models) -> None:
    database.create_tables(models, safe=True)
