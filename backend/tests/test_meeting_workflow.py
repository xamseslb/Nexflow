from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.meeting_workflow import MeetingResult, record_meeting_result
from app.models import CallList, Lead, Meeting, Membership
from test_postgres import as_user, tenant_data


def test_meeting_outcomes_are_a_closed_vocabulary():
    with pytest.raises(ValidationError):
        MeetingResult(outcome="approved")


@pytest.mark.postgres
def test_closer_scope_time_sale_and_duplicate_meeting_outcomes(tenant_data):
    engine, users, partners, projects, lead_id = tenant_data
    pid, mid, future = projects[0], uuid4(), uuid4()
    now = datetime.now(timezone.utc)
    with Session(engine) as db, db.begin():
        db.get(Membership, (pid, users[0])).role = "closer"
        db.get(Membership, (pid, users[1])).role = "leader"
        queue = CallList(project_id=pid, partner_id=partners[0], assignee_id=users[1], name="Booked leads", category="hot")
        db.add(queue)
        db.flush()
        db.get(Lead, lead_id).call_list_id = queue.id
        for meeting_id, offset in ((mid,-2),(future,2)):
            starts = now + timedelta(days=offset)
            db.add(Meeting(id=meeting_id, project_id=pid, partner_id=partners[0], lead_id=lead_id,
                           booker_id=users[1], closer_id=users[0], starts_at=starts,
                           ends_at=starts + timedelta(minutes=30), outcome="booked", qualification={}))
    with as_user(engine, users[1]) as db, pytest.raises(HTTPException) as denied:
        record_meeting_result(pid, mid, MeetingResult(outcome="qualified"), db)
    assert denied.value.status_code == 404
    with as_user(engine, users[0]) as db, pytest.raises(HTTPException) as early:
        record_meeting_result(pid, future, MeetingResult(outcome="qualified"), db)
    assert early.value.status_code == 422
    with as_user(engine, users[0]) as db, pytest.raises(HTTPException) as fake_sale:
        record_meeting_result(pid, mid, MeetingResult(outcome="sold"), db)
    assert fake_sale.value.status_code == 409
    with as_user(engine, users[0]) as db:
        change = MeetingResult(outcome="offer_sent")
        assert record_meeting_result(pid, mid, change, db) == record_meeting_result(pid, mid, change, db)
    with as_user(engine, users[0]) as db:
        assert db.get(Lead, lead_id) is None  # The meeting must not grant access to the customer list.
        assert db.get(Meeting, mid).outcome == "offer_sent"
        with pytest.raises(HTTPException) as finalized:
            record_meeting_result(pid, mid, MeetingResult(outcome="qualified"), db)
        assert finalized.value.status_code == 409

    with Session(engine) as db:
        assert db.get(Lead, lead_id).pipeline_step == 6
        assert db.get(Lead, lead_id).status != "sold"