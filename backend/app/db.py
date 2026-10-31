import json
from functools import lru_cache
from uuid import UUID
from fastapi import Depends, HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from .auth import identity
from .config import settings


@lru_cache
def engine():
    if not settings().database_url:
        raise HTTPException(503, "Database er ikke konfigurert")
    return create_engine(settings().database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)


def session(user_id: UUID = Depends(identity)):
    with Session(engine(), expire_on_commit=False) as db:
        with db.begin():
            # The login itself must not have bypass privileges; reject unsafe deployments.
            unsafe = db.execute(text("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user")).scalar_one()
            if unsafe:
                raise HTTPException(503, "API-databaserollen er feil konfigurert")
            db.execute(text("SET LOCAL ROLE hub_api"))
            db.execute(text("SELECT set_config('request.jwt.claims', :claims, true)"),
                       {"claims": json.dumps({"sub": str(user_id), "role": "authenticated"})})
            db.info["user_id"] = user_id
            yield db
