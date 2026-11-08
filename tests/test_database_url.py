from backend.store import database_url


def test_provider_postgres_urls_use_psycopg3():
    assert database_url("postgres://u:p@h:5432/db") == "postgresql+psycopg://u:p@h:5432/db"
    assert database_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"


def test_explicit_driver_and_sqlite_unchanged():
    assert database_url("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert database_url("sqlite:///runtime/balance.db") == "sqlite:///runtime/balance.db"
