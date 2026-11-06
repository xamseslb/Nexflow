from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.customer import (FlagReason, FlagReview, StageChange, flag_call, profile, quality_queue,
                          review_flag, set_stage)
from app.models import Call, Lead, Membership, Project
from test_postgres import as_user, tenant_data


def test_sold_stage_cannot_be_set_by_profile():
    with pytest.raises(ValidationError):
        StageChange(expected=7, step=8)
    with pytest.raises(ValidationError):
        FlagReason(reason="  ")


@pytest.mark.postgres
def test_stage_uses_expected_value_and_financial_sale_controls_the_last_step(tenant_data):
    engine, users, _, projects, lead_id = tenant_data
    project = projects[0]
    with as_user(engine, users[0]) as db:
        assert profile(project, lead_id, db)["step"] == 1
        assert set_stage(project, lead_id, StageChange(expected=1, step=6), db)["step"] == 6
    with as_user(engine, users[1]) as db, pytest.raises(HTTPException) as stale:
        set_stage(project, lead_id, StageChange(expected=1, step=7), db)
    assert stale.value.status_code == 409
    with as_user(engine, users[2]) as db, pytest.raises(HTTPException) as denied:
        profile(project, lead_id, db)
    assert denied.value.status_code == 403
    with Session(engine) as db, db.begin():
        db.get(Lead, lead_id).status = "sold"
    with as_user(engine, users[0]) as db:
        assert profile(project, lead_id, db)["step"] == 8
        with pytest.raises(HTTPException):
            set_stage(project, lead_id, StageChange(expected=6, step=7), db)


@pytest.mark.postgres
def test_quality_workflow_restricts_sellers_and_reviews(tenant_data):
    engine, users, partners, projects, lead_id = tenant_data
    project, call_id = projects[0], uuid4()
    with Session(engine) as db, db.begin():
        db.add(Call(id=call_id, project_id=project, partner_id=partners[0], lead_id=lead_id,
                    user_id=users[0], completed_at=datetime.now(timezone.utc), outcome="answered",
                    authorization={}, note="Avtal tidspunkt"))
    with as_user(engine, users[1]) as db, pytest.raises(HTTPException) as other_call:
        flag_call(project, lead_id, call_id, FlagReason(reason="Innsyn"), db)
    assert other_call.value.status_code == 404
    with as_user(engine, users[0]) as db:
        body = FlagReason(reason="Ønsker ledergjennomgang")
        flag_id = flag_call(project, lead_id, call_id, body, db)["id"]
        assert flag_call(project, lead_id, call_id, body, db)["id"] == flag_id
    with as_user(engine, users[0]) as db, pytest.raises(HTTPException) as denied:
        review_flag(project, flag_id, FlagReview(note="Forsøk"), db)
    assert denied.value.status_code == 403
    with Session(engine) as db, db.begin():
        db.get(Membership, (project, users[1])).role = "leader"
    with as_user(engine, users[1]) as db:
        assert quality_queue(project, False, 0, db)["items"][0]["id"] == flag_id
        assert review_flag(project, flag_id, FlagReview(note="Rutinene er gjennomgått"), db)["reviewed_at"]
    with as_user(engine, users[1]) as db:
        assert not quality_queue(project, False, 0, db)["items"]
        assert quality_queue(project, True, 0, db)["items"][0]["review_note"] == "Rutinene er gjennomgått"
    with as_user(engine, users[2]) as db, pytest.raises(HTTPException) as cross:
        quality_queue(project, False, 0, db)
    assert cross.value.status_code == 403


def test_public_enrichment_fields_hide_private_and_invalid_data():
    from app.api import lead_payload
    lead = Lead(kind="b2b", enrichment={"employees": 0, "city": "Bergen", "source": "Enhetsregisteret",
                "director": "Private", "industry": {"private": "secret"}})
    assert lead_payload(lead)["enrichment"] == {"employees": 0, "city": "Bergen", "source": "Enhetsregisteret"}
    lead.kind = "b2c"
    assert lead_payload(lead)["enrichment"] == {}


@pytest.mark.postgres
def test_project_type_scoped_manager_edit_and_stale_writes(tenant_data):
    from app.api import projects as read_projects
    from app.customer import ProjectTypeChange, update_project_type
    engine, users, _, projects, _ = tenant_data
    with as_user(engine, users[0]) as db, pytest.raises(HTTPException) as seller:
        update_project_type(projects[0], ProjectTypeChange(project_type="Direktesalg"), db)
    assert seller.value.status_code == 403
    with Session(engine) as db, db.begin():
        db.get(Membership, (projects[0], users[0])).role = "leader"
    with as_user(engine, users[0]) as db:
        assert update_project_type(projects[0], ProjectTypeChange(project_type="  Møtebooking  ", expected=""), db) == {"project_type": "Møtebooking"}
    with as_user(engine, users[0]) as db:
        project = read_projects(db)[0]
        assert project["kind"] == "b2b" and project["project_type"] == "Møtebooking"
        with pytest.raises(HTTPException) as stale:
            update_project_type(projects[0], ProjectTypeChange(project_type="Abonnement", expected=""), db)
        assert stale.value.status_code == 409
    with as_user(engine, users[0]) as db, pytest.raises(HTTPException) as cross:
        update_project_type(projects[1], ProjectTypeChange(project_type="Abonnement"), db)
    assert cross.value.status_code == 403
