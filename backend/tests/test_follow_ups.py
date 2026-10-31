from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from app.models import Project, Membership, FollowUp
from app.schemas import FollowUpCreate, FollowUpUpdate
from app.workspace import create_follow_up, update_follow_up, task_payload, follow_ups, lead_activity


@pytest.fixture
def context():
    user, project, partner, lead = (uuid4() for _ in range(4))
    db = MagicMock()
    db.info = {"user_id": user}
    membership = SimpleNamespace(active=True, role="seller")
    project_row = SimpleNamespace(id=project, partner_id=partner, active=True)
    db.get.side_effect = lambda model, key: membership if model is Membership else project_row if model is Project else None
    body = FollowUpCreate(lead_id=lead, title="Følg opp tilbud", note="Avklar behov", due_at=datetime.now(timezone.utc) + timedelta(days=1), idempotency_key=uuid4())
    return db, body, user, project, partner


def task(body, user, **kwargs):
    return SimpleNamespace(id=uuid4(), lead_id=body.lead_id, title=body.title, note=body.note,
        due_at=body.due_at, status=kwargs.get("status", "open"), assignee_id=kwargs.get("assignee_id", user),
        created_at=datetime.now(timezone.utc), completed_at=None)


def test_retried_creation_returns_existing_task_without_duplicate_audit(context):
    db, body, user, project, _ = context
    existing = task(body, user)
    db.scalar.return_value = existing
    result = create_follow_up(project, body, db)
    assert result["id"] == existing.id
    db.add.assert_not_called()


def test_reused_key_with_different_payload_is_conflict(context):
    db, body, user, project, _ = context
    existing = task(body, user)
    existing.title = "En annen oppgave"
    db.scalar.return_value = existing
    with pytest.raises(HTTPException) as error:
        create_follow_up(project, body, db)
    assert error.value.status_code == 409


@pytest.mark.parametrize("lead_status", ["sold", "declined"])
def test_closed_lead_cannot_get_new_follow_up(context, lead_status):
    db, body, _, project, _ = context
    db.scalar.side_effect = [None, SimpleNamespace(status=lead_status)]
    with pytest.raises(HTTPException) as error:
        create_follow_up(project, body, db)
    assert error.value.status_code == 409
    db.add.assert_not_called()


def test_past_due_creation_rejected(context):
    db, body, _, project, _ = context
    body.due_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.scalar.side_effect = [None, SimpleNamespace(status="new")]
    with pytest.raises(HTTPException) as error:
        create_follow_up(project, body, db)
    assert error.value.status_code == 422


def test_creation_scopes_to_authenticated_user_and_project(context):
    db, body, user, project, partner = context
    db.scalar.side_effect = [None, SimpleNamespace(status="new")]
    def flush():
        created = db.add.call_args_list[0].args[0]
        created.id = uuid4()
        created.created_at = datetime.now(timezone.utc)
    db.flush.side_effect = flush
    result = create_follow_up(project, body, db)
    created = db.add.call_args_list[0].args[0]
    assert isinstance(created, FollowUp)
    assert (created.project_id, created.partner_id, created.assignee_id, created.created_by) == (project, partner, user, user)
    assert result["status"] == "open"
    assert db.add.call_args_list[1].args[0].action == "follow_up.created"


def test_only_owner_or_manager_can_complete_task(context):
    db, body, _, project, _ = context
    db.scalar.return_value = task(body, uuid4())
    with pytest.raises(HTTPException) as error:
        update_follow_up(project, uuid4(), FollowUpUpdate(status="done"), db)
    assert error.value.status_code == 403


def test_completion_is_idempotent_and_terminal(context):
    db, body, user, project, _ = context
    existing = task(body, user)
    db.scalar.return_value = existing
    result = update_follow_up(project, existing.id, FollowUpUpdate(status="done"), db)
    assert result["status"] == "done"
    assert result["completed_at"] is not None
    update_follow_up(project, existing.id, FollowUpUpdate(status="done"), db)
    assert db.add.call_count == 1
    with pytest.raises(HTTPException) as error:
        update_follow_up(project, existing.id, FollowUpUpdate(status="cancelled"), db)
    assert error.value.status_code == 409


def test_overdue_excludes_completed_tasks(context):
    _, body, user, _, _ = context
    existing = task(body, user)
    existing.due_at = datetime.now(timezone.utc) - timedelta(days=1)
    assert task_payload(existing, datetime.now(timezone.utc))["overdue"] is True
    existing.status = "done"
    assert task_payload(existing, datetime.now(timezone.utc))["overdue"] is False


def test_partner_role_cannot_read_tasks_or_activity(context):
    db, body, _, project, _ = context
    db.get.side_effect = lambda model, key: SimpleNamespace(active=True, role="partner")
    for fn in (lambda: follow_ups(project, db=db), lambda: lead_activity(project, body.lead_id, db=db)):
        with pytest.raises(HTTPException) as error:
            fn()
        assert error.value.status_code == 403
    db.scalars.assert_not_called()


def test_task_schema_rejects_naive_dates_and_untrusted_assignment(context):
    _, body, *_ = context
    payload = body.model_dump()
    with pytest.raises(ValidationError):
        FollowUpCreate(**(payload | {"due_at": "2026-11-01T10:00:00"}))
    with pytest.raises(ValidationError):
        FollowUpCreate(**(payload | {"assignee_id": uuid4()}))
    with pytest.raises(ValidationError):
        FollowUpCreate(**(payload | {"title": "   "}))
