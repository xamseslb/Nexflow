import pytest

from app.config import Settings
from app.deployment import validate_configuration, check_production


def configured(**changes):
    return Settings(_env_file=None, **(dict(
        app_env="production",
        database_url="postgresql+psycopg://hub_runtime:test@db.example.test/postgres?sslmode=require",
        worker_database_url="postgresql+psycopg://hub_jobs_runtime:test@db.example.test/postgres?sslmode=require",
        migration_database_url="",
        supabase_url="https://example.supabase.co",
        cors_origins=["https://gorgeous-concha-82f7a1.netlify.app"],
    ) | changes))


@pytest.mark.parametrize("url", [
    "", "not a url",
    "postgresql+psycopg://postgres:test@db.example.test/postgres?sslmode=require",
    "postgresql+psycopg://hub_runtime:test@db.example.test/postgres",
    "postgresql+psycopg://hub_runtime:test@db.example.test/postgres?sslmode=disable",
    "postgresql+psycopg://hub_runtime@db.example.test/postgres?sslmode=require",
])
def test_api_rejects_missing_insecure_or_administrative_connection(url):
    with pytest.raises(RuntimeError, match="dedicated runtime") as error:
        validate_configuration(configured(database_url=url))
    assert "test@" not in str(error.value)


def test_pooler_login_is_accepted_but_worker_cannot_reuse_api_login():
    url = "postgresql+psycopg://hub_runtime.projectref:test@pooler.example.test/postgres?sslmode=require"
    assert validate_configuration(configured(database_url=url)) == url
    with pytest.raises(RuntimeError, match="dedicated runtime"):
        validate_configuration(configured(worker_database_url=url), worker=True)


@pytest.mark.parametrize("origins", [[], ["*"], ["http://localhost:8087"], ["https://example.test/path"]])
def test_production_requires_explicit_https_frontend(origins):
    with pytest.raises(RuntimeError):
        validate_configuration(configured(cors_origins=origins))


def test_admin_credential_is_not_allowed_in_either_service():
    for worker in (False, True):
        with pytest.raises(RuntimeError, match="migration credentials"):
            validate_configuration(configured(migration_database_url="secret"), worker=worker)


def test_worker_needs_no_frontend_or_auth_settings():
    settings = configured(supabase_url="", cors_origins=[])
    assert validate_configuration(settings, worker=True) == settings.worker_database_url


def test_development_does_not_require_production_credentials():
    check_production(Settings(_env_file=None))
