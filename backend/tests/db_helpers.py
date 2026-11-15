"""Open a test transaction with the same role and user identity as an API request."""

import json
from contextlib import contextmanager

from sqlalchemy import text
from sqlalchemy.orm import Session


@contextmanager
def as_user(engine, uid):
    with Session(engine, expire_on_commit=False) as db, db.begin():
        db.execute(text("SET LOCAL ROLE hub_api"))
        db.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(uid)})},
        )
        db.info["user_id"] = uid
        yield db
