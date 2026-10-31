from fastapi.testclient import TestClient
from app.main import app
from app.schemas import LeadCreate, CallResult
from pydantic import ValidationError
import pytest

client = TestClient(app)


def test_liveness_is_public_and_private_responses_not_cached():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("path", ["/api/v1/me", "/api/v1/projects", "/api/v1/projects/00000000-0000-0000-0000-000000000001/leads"])
def test_no_anonymous_crm_access(path):
    assert client.get(path).status_code == 401


def test_cannot_smuggle_security_fields_into_lead():
    with pytest.raises(ValidationError):
        LeadCreate(company="Test", phone="+4799999999", partner_id="other", blocked=False)


def test_phone_cannot_be_used_as_an_arbitrary_url():
    with pytest.raises(ValidationError):
        LeadCreate(company="Test", phone="javascript:alert(1)")


def test_callback_requires_aware_timestamp():
    with pytest.raises(ValidationError):
        CallResult(outcome="callback", callback_at="2026-11-01T10:00:00")


def test_openapi_contains_workflows():
    paths = app.openapi()["paths"]
    assert "/api/v1/projects/{project_id}/leads/{lead_id}/call-authorization" in paths
    assert "/api/v1/projects/{project_id}/sales/{sale_id}/approve" in paths
