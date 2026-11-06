"""Exercise the normal FastAPI routes with two identities and real PostgreSQL RLS."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import session
from app.main import app
from app.models import Membership
from test_postgres import as_user, tenant_data

pytestmark = pytest.mark.postgres


def test_manager_assigns_then_seller_logs_and_advances(tenant_data):
    engine, users, _, projects, lead_id = tenant_data
    manager, seller, outsider = users
    project = projects[0]
    with Session(engine) as db, db.begin():
        db.get(Membership, (project, manager)).role = "leader"

    actor = manager

    def scoped_session():
        with as_user(engine, actor) as db:
            yield db

    app.dependency_overrides[session] = scoped_session
    try:
        client = TestClient(app)
        root = f"/api/v1/projects/{project}"
        response = client.post(f"{root}/call-lists", json={"name": "Prioriterte", "category": "hot", "assignee_id": str(seller)})
        assert response.status_code == 201
        queue = f"{root}/call-lists/{response.json()['id']}"
        assert client.post(queue + "/leads", json={"lead_ids": [str(lead_id)]}).is_success
        actor = outsider
        assert client.post(queue + "/next").status_code == 403
        actor = seller
        assert client.post(queue + "/next").json()["lead"]["id"] == str(lead_id)
        assert client.get(f"{root}/customers/{lead_id}").json()["step"] == 2
        call = client.post(f"{root}/leads/{lead_id}/call-authorization")
        assert call.status_code == 201
        path = f"{root}/calls/{call.json()['id']}"
        outcome = {"outcome": "answered", "note": "Send tilbudet til kontaktpersonen."}
        assert client.patch(path, json=outcome).is_success
        assert client.patch(path, json=outcome).is_success
        assert client.post(queue + "/next").json()["lead"] is None
        assert client.get(f"{root}/customers/{lead_id}").json()["calls"][0]["note"] == outcome["note"]
    finally:
        app.dependency_overrides.pop(session)

