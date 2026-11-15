"""Run only against an explicitly supplied, migrated disposable PostgreSQL database."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from db_helpers import as_user
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.calls import reserve
from app.models import Lead, Membership
from app.project_access import project_access

pytestmark = pytest.mark.postgres


def test_rls_hides_other_partner_and_api_returns_403(tenant_data):
    engine, users, _, projects, lead_id = tenant_data
    with as_user(engine, users[2]) as db:
        assert db.get(Lead, lead_id) is None
        with pytest.raises(HTTPException) as error:
            project_access(db, projects[0])
        assert error.value.status_code == 403


def test_two_simultaneous_sellers_cannot_reserve_same_lead(tenant_data):
    engine, users, _, projects, lead_id = tenant_data
    barrier = Barrier(2)

    def claim(uid):
        try:
            with as_user(engine, uid) as db:
                barrier.wait(timeout=10)
                reserve(projects[0], lead_id, db)
            return 200
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, users[:2]))
    assert sorted(results) == [200, 409]


def test_transaction_identity_does_not_leak_through_pool(tenant_data):
    engine, users, _, _, lead_id = tenant_data
    with as_user(engine, users[0]) as db:
        assert db.get(Lead, lead_id) is not None
    with as_user(engine, users[2]) as db:
        assert db.get(Lead, lead_id) is None


def test_partner_role_cannot_reserve(tenant_data):
    engine, users, _, projects, lead_id = tenant_data
    with as_user(engine, users[2]) as db, pytest.raises(HTTPException) as error:
        reserve(projects[1], lead_id, db)
    assert error.value.status_code == 403


def test_follow_up_rls_hides_other_sellers_tasks(tenant_data):
    from datetime import datetime, timedelta, timezone

    from app.models import FollowUp
    from app.schemas import FollowUpCreate
    from app.workspace import create_follow_up

    engine, users, _, projects, lead_id = tenant_data
    with as_user(engine, users[0]) as db:
        created = create_follow_up(
            projects[0],
            FollowUpCreate(
                lead_id=lead_id,
                title="Oppfølging",
                due_at=datetime.now(timezone.utc) + timedelta(days=1),
                idempotency_key=uuid4(),
            ),
            db,
        )
    with as_user(engine, users[0]) as db:
        assert db.get(FollowUp, created["id"]) is not None
    with as_user(engine, users[1]) as db:
        assert db.get(FollowUp, created["id"]) is None
    with as_user(engine, users[2]) as db:
        assert db.get(FollowUp, created["id"]) is None


def test_concurrent_follow_up_retries_create_one_task(tenant_data):
    from datetime import datetime, timedelta, timezone

    from app.models import FollowUp
    from app.schemas import FollowUpCreate
    from app.workspace import create_follow_up

    engine, users, _, projects, lead_id = tenant_data
    body = FollowUpCreate(
        lead_id=lead_id,
        title="Oppfølging",
        due_at=datetime.now(timezone.utc) + timedelta(days=1),
        idempotency_key=uuid4(),
    )
    barrier = Barrier(2)

    def create(_):
        with as_user(engine, users[0]) as db:
            barrier.wait(timeout=10)
            return create_follow_up(projects[0], body, db)["id"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(create, range(2)))
    assert ids[0] == ids[1]
    with as_user(engine, users[0]) as db:
        assert len(list(db.scalars(select(FollowUp)))) == 1


def test_manager_report_executes_postgresql_aggregates(tenant_data):
    from datetime import datetime, timezone

    from app.workspace import report

    engine, users, _, projects, _ = tenant_data
    with Session(engine) as db, db.begin():
        db.execute(
            Membership.__table__.update()
            .where(Membership.user_id == users[0])
            .values(role="leader")
        )
    today = datetime.now(timezone.utc).date()
    with as_user(engine, users[0]) as db:
        result = report(projects[0], start=today, end=today, timezone="UTC", db=db)
        assert result["totals"]["leads"] == 1
        assert result["totals"]["revenue_ore"] == 0
        assert result["cohort"]["conversion_percent"] == 0
        assert result["distributions"]["sale_amount"]["available"] is False


def test_call_history_scopes_notes_and_excludes_unfinished_calls(tenant_data):
    from datetime import datetime, timezone

    from app.calls import call_history
    from app.models import Call

    engine, users, partners, projects, lead_id = tenant_data
    with Session(engine) as db, db.begin():
        for seller in users[:2]:
            db.add(
                Call(
                    project_id=projects[0],
                    partner_id=partners[0],
                    lead_id=lead_id,
                    user_id=seller,
                    completed_at=datetime.now(timezone.utc),
                    outcome="answered",
                    note=str(seller),
                    authorization={},
                )
            )
        db.add(
            Call(
                project_id=projects[0],
                partner_id=partners[0],
                lead_id=lead_id,
                user_id=users[0],
                authorization={},
            )
        )
    with as_user(engine, users[0]) as db:
        assert [row["note"] for row in call_history(projects[0], lead_id, db)] == [str(users[0])]
    with as_user(engine, users[2]) as db, pytest.raises(HTTPException) as error:
        call_history(projects[0], lead_id, db)
    assert error.value.status_code == 403
    with Session(engine) as db, db.begin():
        db.get(Membership, (projects[0], users[0])).role = "leader"
    with as_user(engine, users[0]) as db:
        assert {row["note"] for row in call_history(projects[0], lead_id, db)} == set(
            map(str, users[:2])
        )
