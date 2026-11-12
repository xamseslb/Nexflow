"""Fail closed on incomplete production configuration, without logging secrets."""
from urllib.parse import urlsplit

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from .config import Settings


def validate_configuration(config: Settings, *, worker: bool = False) -> str:
    if config.migration_database_url:
        raise RuntimeError("Keep migration credentials out of running services")
    database_url = config.worker_database_url if worker else config.database_url
    expected_user = "hub_jobs_runtime" if worker else "hub_runtime"
    try:
        url = make_url(database_url)
        valid = (url.drivername == "postgresql+psycopg" and url.host and url.password
                 and url.username and url.username.split(".", 1)[0] == expected_user
                 and url.query.get("sslmode") in ("require", "verify-ca", "verify-full"))
    except (ValueError, SQLAlchemyError):
        valid = False
    if not valid:
        raise RuntimeError("Configure a TLS PostgreSQL connection with the dedicated runtime login")
    if not worker:
        auth = urlsplit(config.supabase_url)
        if (auth.scheme != "https" or not auth.hostname or auth.username or auth.password
                or auth.path not in ("", "/") or auth.query or auth.fragment):
            raise RuntimeError("Configure the HTTPS Supabase project URL")
        if not config.cors_origins:
            raise RuntimeError("Configure the exact frontend HTTPS origin")
        for origin in config.cors_origins:
            parsed = urlsplit(origin)
            if (parsed.scheme != "https" or not parsed.hostname or "*" in origin
                    or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
                raise RuntimeError("Production CORS requires explicit HTTPS origins without paths")
    return database_url


def verify_database(database_url: str, *, worker: bool = False) -> None:
    engine = create_engine(database_url, connect_args={"connect_timeout": 10}, pool_pre_ping=True)
    role = "hub_worker" if worker else "hub_api"
    try:
        with engine.begin() as connection:
            unsafe = connection.scalar(text("""
                SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
                FROM pg_roles WHERE rolname = current_user
            """))
            if unsafe is not False:
                raise RuntimeError("Runtime login must not have administrative privileges")
            # Fixed identifiers only, never input from requests or environment variables.
            connection.execute(text(f"SET LOCAL ROLE {role}"))
            unprotected = connection.scalar(text("""
                SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='hub' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
            """))
            if unprotected:
                raise RuntimeError("RLS must be enabled on every CRM table")
            table = "jobs" if worker else "projects"
            connection.execute(text(f"SELECT id FROM hub.{table} LIMIT 0"))
    except SQLAlchemyError:
        # Driver errors can contain URLs, usernames and passwords. Do not expose them.
        raise RuntimeError("Database startup check failed; verify connection, migrations and role grants") from None
    finally:
        engine.dispose()


def check_production(config: Settings, *, worker: bool = False) -> None:
    if config.app_env == "production":
        verify_database(validate_configuration(config, worker=worker), worker=worker)
