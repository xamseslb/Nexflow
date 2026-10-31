import json
from pathlib import Path
import httpx
import pytest
from app.worker import company_data


def test_brreg_contract_and_field_whitelist():
    fixture = json.loads((Path(__file__).parent / "fixtures/brreg.json").read_text(encoding="utf-8"))
    def respond(request):
        assert request.url.host == "data.brreg.no"
        assert request.url.path.endswith("/123456789")
        return httpx.Response(200, json=fixture)
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result = company_data("123456789", client)
    assert result["employees"] == 12
    assert result["industry"] == "Arkitektvirksomhet"
    assert "dagligLeder" not in result
    assert result["city"] == "BERGEN"


def test_org_number_cannot_redirect_worker():
    with httpx.Client() as client, pytest.raises(ValueError):
        company_data("../secret", client)
