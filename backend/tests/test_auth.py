from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import app.auth as auth


@pytest.fixture
def signed_identity(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(auth, "settings", lambda: SimpleNamespace(supabase_url="https://test.supabase.co"))
    monkeypatch.setattr(auth, "jwks_client", lambda: SimpleNamespace(get_signing_key_from_jwt=lambda token: SimpleNamespace(key=key.public_key())))
    current = datetime.now(timezone.utc)
    base = {"sub": str(uuid4()), "exp": current + timedelta(minutes=5), "iat": current,
            "aud": "authenticated", "iss": "https://test.supabase.co/auth/v1", "role": "authenticated"}
    def credentials(overrides):
        return HTTPAuthorizationCredentials(scheme="Bearer", credentials=jwt.encode(base | overrides, key, algorithm="RS256"))
    return base, credentials


def test_verified_identity(signed_identity):
    base, credentials = signed_identity
    assert str(auth.identity(credentials({}))) == base["sub"]


@pytest.mark.parametrize("override", [
    {"aud": "another-service"}, {"iss": "https://attacker.invalid/auth/v1"},
    {"role": "service_role"}, {"is_anonymous": True}, {"sub": "not-a-uuid"}, {"exp": 1},
])
def test_untrusted_claims_are_rejected(signed_identity, override):
    _, credentials = signed_identity
    with pytest.raises(HTTPException) as error:
        auth.identity(credentials(override))
    assert error.value.status_code == 401


def test_identity_provider_outage_is_retryable(monkeypatch):
    from jwt.exceptions import PyJWKClientConnectionError
    monkeypatch.setattr(auth, "settings", lambda: SimpleNamespace(supabase_url="https://test.supabase.co"))
    def unavailable(token):
        raise PyJWKClientConnectionError("provider unavailable")
    monkeypatch.setattr(auth, "jwks_client", lambda: SimpleNamespace(get_signing_key_from_jwt=unavailable))
    with pytest.raises(HTTPException) as error:
        auth.identity(HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"))
    assert error.value.status_code == 503
    assert error.value.headers["Retry-After"] == "30"
    assert "provider unavailable" not in error.value.detail
