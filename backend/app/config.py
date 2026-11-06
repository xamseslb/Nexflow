from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    supabase_url: str = ""
    database_url: str = ""
    migration_database_url: str = ""
    worker_database_url: str = ""
    cors_origins: list[str] = ["http://localhost:8087", "http://127.0.0.1:8087"]


@lru_cache
def settings() -> Settings:
    return Settings()
