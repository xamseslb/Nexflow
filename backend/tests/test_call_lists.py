"""Queue/RLS integration tests. Each case uses an isolated project fixture."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api import authorize_call, complete_call, release, reserve
from app.call_lists import (ListAssignment, ListCreate, ListLeads, assign_list, create_list,
                            list_leads, lists, move_leads, next_contact)
from app.models import Lead, Membership, RegistryCheck
from app.schemas import CallResult
from test_postgres import as_user, tenant_data

pytestmark = pytest.mark.postgres


@pytest.fixture
def calling(tenant_data):
    engine, users, partners, projects, lead_id = tenant_data
    pid = projects[0]
    manager, seller = users[:2]
    with Session(engine) as db, db.begin():
        db.get(Membership, (pid, manager)).role = "leader"
    with as_user(engine, manager) as db:
        cold = create_list(pid, ListCreate(name="Nykunder", category="cold", assignee_id=seller), db)["id"]
        hot = create_list(pid, ListCreate(name="Innkommende", category="hot", assignee_id=manager), db)["id"]
        move_leads(pid, cold, ListLeads(lead_ids=[lead_id]), db)
    return engine, pid, partners[0], manager, seller, cold, hot, lead_id


def test_queue_access_and_atomic_moves(calling):
    engine, pid, _, manager, seller, cold, hot, lead_id = calling
    with as_user(engine, seller) as db:
        assert [q["id"] for q in lists(pid, db)] == [cold]
        assert [l["id"] for l in list_leads(pid, cold, db)] == [lead_id]
        with pytest.raises(HTTPException) as exc:
            list_leads(pid, hot, db)
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc:
            move_leads(pid, hot, ListLeads(lead_ids=[lead_id]), db)
        assert exc.value.status_code == 403
    with as_user(engine, manager) as db, pytest.raises(HTTPException):
        move_leads(pid, hot, ListLeads(lead_ids=[lead_id, uuid4()]), db)
    with as_user(engine, manager) as db:
        assert list_leads(pid, cold, db)[0]["id"] == lead_id
        move_leads(pid, hot, ListLeads(lead_ids=[lead_id]), db)
    with as_user(engine, seller) as db:
        assert db.get(Lead, lead_id) is None
        with pytest.raises(HTTPException) as exc:
            reserve(pid, lead_id, db)
        assert exc.value.status_code == 404
    with as_user(engine, manager) as db:
        assign_list(pid, hot, ListAssignment(assignee_id=seller), db)
    with as_user(engine, seller) as db:
        assert next_contact(pid, hot, db)["lead"]["id"] == lead_id


def test_next_retry_completion_and_callback(calling):
    engine, pid, _, manager, seller, cold, _, lead_id = calling
    with as_user(engine, seller) as db:
        assert next_contact(pid, cold, db)["lead"]["id"] == lead_id
    with as_user(engine, manager) as db, pytest.raises(HTTPException) as exc:
        assign_list(pid, cold, ListAssignment(assignee_id=manager), db)
    assert exc.value.status_code == 409
    with as_user(engine, seller) as db:
        assert next_contact(pid, cold, db)["lead"]["id"] == lead_id
        call = authorize_call(pid, lead_id, db)
        assert authorize_call(pid, lead_id, db)["id"] == call["id"]
    result = CallResult(outcome="callback", callback_at=datetime.now(timezone.utc) + timedelta(days=2), note="Ring fredag")
    with as_user(engine, seller) as db:
        complete_call(pid, call["id"], result, db)
    with as_user(engine, seller) as db:
        complete_call(pid, call["id"], result, db)
        assert next_contact(pid, cold, db)["lead"] is None
        with pytest.raises(HTTPException) as exc:
            authorize_call(pid, lead_id, db)
        assert exc.value.status_code == 409
    with Session(engine) as db, db.begin():
        db.get(Lead, lead_id).callback_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    with as_user(engine, seller) as db:
        assert next_contact(pid, cold, db)["lead"]["id"] == lead_id
        call = authorize_call(pid, lead_id, db)
        complete_call(pid, call["id"], CallResult(outcome="answered", note="Møte neste uke"), db)
        assert next_contact(pid, cold, db)["lead"] is None


def test_next_checks_b2c_and_reopens_explicit_winback(calling):
    engine, pid, partner, manager, seller, cold, _, lead_id = calling
    with Session(engine) as db, db.begin():
        lead = db.get(Lead, lead_id)
        lead.status = "declined"
        lead.kind = "b2c"
    with as_user(engine, manager) as db:
        winback = create_list(pid, ListCreate(name="Tidligere kunder", category="winback", assignee_id=seller), db)["id"]
        move_leads(pid, winback, ListLeads(lead_ids=[lead_id]), db)
    with as_user(engine, seller) as db:
        assert next_contact(pid, winback, db)["lead"] is None
    with Session(engine) as db, db.begin():
        db.add(RegistryCheck(lead_id=lead_id, partner_id=partner, project_id=pid, phone="+4799999999",
                             checked_at=datetime.now(timezone.utc), reserved=False, source="test"))
    with as_user(engine, seller) as db:
        assert next_contact(pid, winback, db)["lead"]["id"] == lead_id
        release(pid, lead_id, db)
    with Session(engine) as db, db.begin():
        db.get(Lead, lead_id).blocked = True
    with as_user(engine, seller) as db:
        assert next_contact(pid, winback, db)["lead"] is None


def test_queue_concurrent_operators_cannot_claim_same_lead(calling):
    engine, pid, _, manager, seller, cold, _, lead_id = calling
    barrier = Barrier(2)

    def claim(uid):
        with as_user(engine, uid) as db:
            barrier.wait(timeout=10)
            lead = next_contact(pid, cold, db)["lead"]
            return lead["id"] if lead else None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, (manager, seller)))
    assert results.count(lead_id) == 1
    assert results.count(None) == 1



def test_assigned_contact_handover_includes_notes_and_hides_previous_owner(tenant_data):
    from app.api import call_history, meetings
    from app.models import Meeting

    engine, users, partners, projects, lead_id = tenant_data
    pid = projects[0]
    manager, first, second = users
    with Session(engine) as db, db.begin():
        db.get(Membership, (pid, manager)).role = "leader"
        db.add(Membership(project_id=pid, user_id=second, role="seller", active=True))
    with as_user(engine, manager) as db:
        q = create_list(pid, ListCreate(name="Overføring", category="hot", assignee_id=first), db)["id"]
        move_leads(pid, q, ListLeads(lead_ids=[lead_id]), db)
    with as_user(engine, first) as db:
        call = authorize_call(pid, lead_id, db)
        complete_call(pid, call["id"], CallResult(outcome="answered", note="Avtal oppfølging i mai"), db)
    with Session(engine) as db, db.begin():
        starts = datetime.now(timezone.utc) + timedelta(days=1)
        db.add(Meeting(project_id=pid, partner_id=partners[0], lead_id=lead_id,
                       starts_at=starts, ends_at=starts + timedelta(hours=1), booker_id=manager,
                       closer_id=manager, outcome="booked", qualification={"behov": "Skjermet"}))
    with as_user(engine, manager) as db:
        assign_list(pid, q, ListAssignment(assignee_id=second), db)
    with as_user(engine, second) as db:
        history = call_history(pid, lead_id, db)
        assert [c["note"] for c in history] == ["Avtal oppfølging i mai"]
        assert history[0]["can_flag"] is False
    with as_user(engine, first) as db:
        with pytest.raises(HTTPException) as exc:
            call_history(pid, lead_id, db)
        assert exc.value.status_code == 404
        assert meetings(pid, db) == []


def test_manager_delegates_only_accessible_tasks_and_can_reassign(calling):
    from app.models import FollowUp
    from app.schemas import FollowUpAssignment, FollowUpCreate
    from app.workspace import create_follow_up, reassign_follow_up

    engine, pid, _, manager, seller, _, hot, lead_id = calling
    body = FollowUpCreate(assignee_id=seller, lead_id=lead_id, title="Sjekk tilbud",
                          due_at=datetime.now(timezone.utc) + timedelta(days=1), idempotency_key=uuid4())
    with as_user(engine, manager) as db:
        task = create_follow_up(pid, body, db)
        assert task["assignee_id"] == seller
    with as_user(engine, seller) as db:
        assert db.get(FollowUp, task["id"]) is not None
        with pytest.raises(HTTPException) as exc:
            reassign_follow_up(pid, task["id"], FollowUpAssignment(assignee_id=manager), db)
        assert exc.value.status_code == 403
    with as_user(engine, manager) as db:
        reassign_follow_up(pid, task["id"], FollowUpAssignment(assignee_id=manager), db)
        assert create_follow_up(pid, body, db)["id"] == task["id"]  # original retry after reassignment
        move_leads(pid, hot, ListLeads(lead_ids=[lead_id]), db)
    with as_user(engine, seller) as db:
        assert db.get(FollowUp, task["id"]) is None
    with as_user(engine, manager) as db, pytest.raises(HTTPException) as exc:
        reassign_follow_up(pid, task["id"], FollowUpAssignment(assignee_id=seller), db)
    assert exc.value.status_code == 422


def test_abandoned_call_is_not_reused_after_restart(calling):
    from app.api import call_history

    engine, pid, _, _, seller, cold, _, lead_id = calling
    with as_user(engine, seller) as db:
        next_contact(pid, cold, db)
        abandoned = authorize_call(pid, lead_id, db)["id"]
        release(pid, lead_id, db)
    with as_user(engine, seller) as db:
        assert next_contact(pid, cold, db)["lead"]["id"] == lead_id
        replacement = authorize_call(pid, lead_id, db)["id"]
        assert replacement != abandoned
        with pytest.raises(HTTPException) as exc:
            complete_call(pid, abandoned, CallResult(outcome="no_answer"), db)
        assert exc.value.status_code == 409
        complete_call(pid, replacement, CallResult(outcome="answered"), db)
        assert [c["id"] for c in call_history(pid, lead_id, db)] == [replacement]
