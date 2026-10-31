from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from .config import settings

bearer = HTTPBearer(auto_error=False)


@lru_cache
def jwks_client() -> PyJWKClient:
    return PyJWKClient(f"{settings().supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=300)


def identity(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> UUID:
    if not credentials:
        raise HTTPException(401, "Logg inn for å fortsette", headers={"WWW-Authenticate": "Bearer"})
    if not settings().supabase_url:
        raise HTTPException(503, "Supabase Auth er ikke konfigurert")
    try:
        key = jwks_client().get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials, key.key, algorithms=["ES256", "RS256"],
            audience="authenticated", issuer=f"{settings().supabase_url.rstrip('/')}/auth/v1",
            options={"require": ["sub", "exp", "iat", "aud", "iss"]},
        )
        if claims.get("role") != "authenticated" or claims.get("is_anonymous", False):
            raise ValueError("Unsupported identity")
        return UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, TypeError):
        raise HTTPException(401, "Ugyldig eller utløpt innlogging", headers={"WWW-Authenticate": "Bearer"}) from None
