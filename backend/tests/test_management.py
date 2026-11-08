import json
from contextlib import contextmanager
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app.api import sales
from app.management import AccessChange, change_access, members, sales_portfolio
from app.models import Membership, Product, Sale
from test_postgres import as_user, tenant_data

pytestmark = pytest.mark.postgres


def test_project_admin_can_disable_existing_member(tenant_data):
    engine, users, _, projects, _ = tenant_data
    with as_user(engine, users[0]) as db, pytest.raises(HTTPException) as exc:
        change_access(projects[0], users[1], AccessChange(role="leader", active=True), db)
    assert exc.value.status_code == 403
    with Session(engine) as db, db.begin():
        db.get(Membership, (projects[0], users[0])).role = "admin"
    with as_user(engine, users[0]) as db:
        assert len(members(projects[0], db)) == 2
        change_access(projects[0], users[1], AccessChange(role="seller", active=False), db)
    with as_user(engine, users[1]) as db, pytest.raises(HTTPException) as exc:
        members(projects[0], db)
    assert exc.value.status_code == 403


@contextmanager
def storage_user(engine, uid):
    with Session(engine) as db, db.begin():
        db.execute(text("SET LOCAL ROLE authenticated"))
        db.execute(text("SELECT set_config('request.jwt.claims', :claims, true)"),
                   {"claims": json.dumps({"sub": str(uid)})})
        yield db


def test_sale_portfolio_and_private_storage_isolation(tenant_data):
    engine, users, partners, projects, lead = tenant_data
    seller, manager, outsider = users
    sale_id, product_id = uuid4(), uuid4()
    scope = {"project_id": projects[0], "partner_id": partners[0]}
    with Session(engine) as db, db.begin():
        db.get(Membership, (projects[0], manager)).role = "leader"
        db.add(Product(id=product_id, name="Pakken", price_ore=78901, hub_bps=0, seller_bps=1000, **scope))
        db.flush()
        db.add(Sale(id=sale_id, product_id=product_id, lead_id=lead, seller_id=seller, amount_ore=78901,
                    allocation={"seller": 7000, "hub": 0, "partner": 71901}, rule_snapshot={}, idempotency_key=uuid4(), **scope))
    with as_user(engine, manager) as db:
        assert sales(projects[0], db)[0]['can_manage_documents']
        report = sales_portfolio(None, None, 0, db)
        assert report["total_ore"] == 78901
        assert [s["id"] for s in report["items"]] == [sale_id]
    with as_user(engine, seller) as db:
        assert sales(projects[0], db)[0]['can_manage_documents']
        assert sales_portfolio(None, None, 0, db)["count"] == 0
    with Session(engine) as db, db.begin():
        db.add(Membership(project_id=projects[0], user_id=outsider, role='partner'))
    with as_user(engine, outsider) as db:
        assert all(not s['can_manage_documents'] for s in sales(projects[0], db))
    path = f"{projects[0]}/{sale_id}/receipt.pdf"
    query = text("SELECT name FROM storage.objects WHERE bucket_id='nexflow-sale-documents' AND name=:path")
    insert = text("INSERT INTO storage.objects(bucket_id,name) VALUES('nexflow-sale-documents', :path)")
    try:
        with storage_user(engine, seller) as db:
            db.execute(insert, {"path": path})
        with storage_user(engine, manager) as db:
            assert db.scalar(query, {"path": path}) == path
        with storage_user(engine, outsider) as db:
            assert db.scalar(query, {"path": path}) is None
        with storage_user(engine, outsider) as db, pytest.raises(ProgrammingError):
            db.execute(insert, {"path": path + ".png"})
    finally:
        with Session(engine) as db, db.begin():
            db.execute(text("DELETE FROM storage.objects WHERE bucket_id='nexflow-sale-documents' AND name=:path"), {"path": path})



def test_portfolio_types_team_activities_and_historical_buyers(tenant_data):
    from datetime import datetime, timedelta, timezone
    from app.models import Call, CallList, Lead, Meeting, Project

    engine, users, partners, projects, lead_id = tenant_data
    seller, manager, outsider = users
    pid, other = projects
    product_id, queue_id = uuid4(), uuid4()
    scope = {"project_id": pid, "partner_id": partners[0]}
    today = datetime.now(timezone.utc)
    with Session(engine) as db, db.begin():
        db.get(Project, pid).project_type = "Abonnement"
        db.get(Project, other).project_type = "Kampanje"
        db.get(Membership, (pid, manager)).role = "leader"
        db.get(Membership, (pid, seller)).team_name = "Gamle team"
        db.add(Membership(project_id=other, user_id=manager, role="seller", active=True, team_name="Skjermet"))
        db.add(Lead(project_id=other, partner_id=partners[1], company="Annet prosjekt", phone="+4799000000"))
        db.add(Product(id=product_id, name="Pakken", price_ore=10000, hub_bps=0, seller_bps=1000, **scope))
        db.add(CallList(id=queue_id, category="hot", name="Varme leads", assignee_id=seller, **scope))
        db.flush()
        db.get(Lead, lead_id).call_list_id = queue_id
        db.add(Call(lead_id=lead_id, user_id=seller, completed_at=today, outcome="answered", authorization={}, **scope))
        db.add(Call(lead_id=lead_id, user_id=seller, authorization={}, **scope))
        db.add(Meeting(lead_id=lead_id, booker_id=seller, closer_id=manager, starts_at=today,
                       ends_at=today + timedelta(minutes=30), qualification={}, **scope))
        db.add(Sale(product_id=product_id, lead_id=lead_id, seller_id=seller, amount_ore=10000,
                    allocation={"seller": 1000, "hub": 0, "partner": 9000}, rule_snapshot={},
                    idempotency_key=uuid4(), **scope))
    with Session(engine) as db, db.begin():
        db.get(Membership, (pid, seller)).team_name = "Nye team"
    with as_user(engine, manager) as db:
        report = sales_portfolio(None, None, 0, db, project_type="Abonnement")
        assert report["teams"] == ["Gamle team", "Nye team"]
        assert report["project_types"] == ["Abonnement"]
        assert report["activity"] == {"leads": 1, "calls": 1, "meetings": 1, "buyers": 1}
        assert report["per_project"] == [{"project_id": pid, "project": "Isolated test project",
                                          "count": 1, "total_ore": 10000}]
        old_team = sales_portfolio(pid, None, 0, db, team="Gamle team")
        assert old_team["activity"] == {"leads": 0, "calls": 0, "meetings": 0, "buyers": 1}
        assert old_team["items"][0]["team"] == "Gamle team"
        new_team = sales_portfolio(pid, None, 0, db, team="Nye team")
        assert new_team["activity"] == {"leads": 1, "calls": 1, "meetings": 1, "buyers": 0}
        assert new_team["per_project"] == []
        lead_status = db.get(Lead, lead_id).status
        assert sales_portfolio(pid, None, 0, db, metric="leads", stage=lead_status)["items"][0]["id"] == lead_id
        other_status = "declined" if lead_status != "declined" else "new"
        assert sales_portfolio(pid, None, 0, db, metric="leads", stage=other_status)["items"] == []
        for metric in ("leads", "calls", "meetings", "buyers"):
            for team, expected in (("Gamle team", old_team), ("Nye team", new_team)):
                details = sales_portfolio(None, None, 0, db, metric=metric, team=team)
                assert len(details["items"]) == expected["activity"][metric]
                assert all(row["project"] == "Isolated test project" for row in details["items"])
                assert all(row["lead_id"] == lead_id and row["project_id"] == pid for row in details["items"])
                assert details["has_more"] is False
            assert sales_portfolio(None, None, 1, db, metric=metric)["items"] == []
            with pytest.raises(HTTPException) as denied:
                sales_portfolio(other, None, 0, db, metric=metric)
            assert denied.value.status_code == 403
        assert sales_portfolio(None, None, 0, db, project_type="Kampanje")["activity"]["leads"] == 0
        with pytest.raises(HTTPException) as exc:
            sales_portfolio(other, None, 0, db)
        assert exc.value.status_code == 403
    with Session(engine) as db, db.begin():
        db.get(Membership, (other, manager)).role = "leader"
    with as_user(engine, manager) as db:
        assert sales_portfolio(None, None, 0, db)["activity"]["leads"] == 2
        assert sales_portfolio(None, None, 0, db, project_type="Kampanje")["activity"]["leads"] == 1
