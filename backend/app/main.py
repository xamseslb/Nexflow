from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from .api import router
from .workspace import router as workspace_router
from .config import settings

app = FastAPI(title="Hub CRM", version="0.1.0", description="Partnerisolert CRM med Supabase Auth")
app.add_middleware(CORSMiddleware, allow_origins=settings().cors_origins,
                   allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "DELETE"],
                   allow_headers=["Authorization", "Content-Type"])
app.include_router(router)
app.include_router(workspace_router)


@app.middleware("http")
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.exception_handler(IntegrityError)
async def conflict(request: Request, exc: IntegrityError):
    return JSONResponse(status_code=409, content={"detail": "Handlingen kolliderer med eksisterende data. Oppdater og prøv igjen."})


@app.get("/api/health")
def health():
    # Liveness only. No database or credential details exposed.
    return {"status": "ok", "version": "0.1.0"}
