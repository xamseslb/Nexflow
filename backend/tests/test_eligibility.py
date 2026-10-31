from types import SimpleNamespace
from uuid import uuid4
import pytest
from app.api import eligibility


@pytest.mark.parametrize("status", ["sold", "declined"])
def test_closed_leads_are_not_presented_as_callable(status):
    """The read endpoint must agree with the call authorization endpoint."""
    user_id = uuid4()
    db = SimpleNamespace(info={"user_id": user_id}, scalar=lambda query: None)
    project = SimpleNamespace(active=True, partner_id=uuid4())
    lead = SimpleNamespace(id=uuid4(), phone="+4799999999", kind="b2b", blocked=False,
                           reserved_by=None, reserved_until=None, status=status)
    decision, evidence = eligibility(db, project, lead)
    assert decision.allowed is False
    assert evidence["allowed"] is False
    assert evidence["reason"] == "Leadet er avsluttet"
