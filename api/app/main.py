import hashlib
import secrets
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import create_engine, delete, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.orm import sessionmaker
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.config import Settings
from app.models import AuditEvent, HouseholdUser, Session, Traveller
from app.travel_api import travel_router

COOKIE_NAME = "schengen_session"
SESSION_SECONDS = 12 * 60 * 60
passwords = PasswordHasher()
DUMMY_HASH = passwords.hash(secrets.token_urlsafe(32))


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def as_utc(value: datetime) -> datetime:
    # SQLite is used only by local tests and drops timezone metadata.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1024)


class TravellerView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_name: str
    rule_applicable: bool | None
    history_complete: bool
    history_reviewed_on: date | None
    notes: str
    version: int


class TravellerUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    display_name: str = Field(min_length=1, max_length=100)
    rule_applicable: bool | None
    history_complete: bool
    notes: str = Field(default="", max_length=2000)
    version: int = Field(ge=1)


def create_app(settings: Settings | None = None, *, engine=None) -> FastAPI:
    settings = settings or Settings.from_env()
    engine = engine or create_engine(settings.database_url, pool_pre_ping=True)
    sessions = sessionmaker(engine, expire_on_commit=False)
    app = FastAPI(
        title="Schengen Travel Planner",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        errors = [
            {
                "field": ".".join(str(part) for part in item["loc"] if part != "body"),
                "message": item["msg"],
            }
            for item in error.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "detail": {
                    "code": "INVALID_INPUT",
                    "message": "; ".join(f"{item['field']}: {item['message']}" for item in errors),
                    "errors": errors,
                }
            },
        )

    @app.middleware("http")
    async def request_security(request: Request, call_next):
        chunks = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            limit = (
                1_048_576
                if request.url.path
                in {"/api/v1/imports/history/preview", "/api/v1/imports/history/commit"}
                else 16_384
            )
            if size > limit:
                return Response(status_code=413)
            chunks.append(chunk)
        request._body = b"".join(chunks)
        if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
            # A non-simple header prevents cross-origin browser form/login CSRF.
            if request.headers.get("x-requested-with") != "SchengenPlanner":
                return Response(status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    def database():
        with sessions() as db:
            yield db

    def authenticated(request: Request, db: DBSession = Depends(database)) -> Session:
        token = request.cookies.get(COOKIE_NAME)
        session = db.get(Session, digest(token)) if token else None
        if session is None or as_utc(session.expires_at) <= datetime.now(UTC):
            raise HTTPException(401, detail={"code": "AUTH_REQUIRED", "message": "Please sign in"})
        if request.method not in {"GET", "HEAD", "OPTIONS"} and not secrets.compare_digest(
            request.headers.get("x-csrf-token", ""), session.csrf_token
        ):
            raise HTTPException(403, detail={"code": "CSRF_FAILED", "message": "Refresh and retry"})
        return session

    @app.get("/api/v1/health/live")
    def live():
        return {"status": "ok", "version": "1.0.0"}

    @app.get("/api/v1/health/ready")
    def ready(db: DBSession = Depends(database)):
        try:
            db.execute(text("SELECT 1"))
            db.execute(select(HouseholdUser.id).limit(1))
        except SQLAlchemyError:
            raise HTTPException(503, "Database or schema unavailable") from None
        return {"status": "ready"}

    @app.post("/api/v1/auth/login")
    def login(
        payload: Login, request: Request, response: Response, db: DBSession = Depends(database)
    ):
        now = datetime.now(UTC)
        # Serialize attempts against the singleton account, including unknown names.
        user = db.scalar(select(HouseholdUser).with_for_update())
        if user and user.locked_until and as_utc(user.locked_until) > now:
            raise HTTPException(429, "Too many attempts; retry in 15 minutes")
        try:
            valid = passwords.verify(user.password_hash if user else DUMMY_HASH, payload.password)
        except (VerificationError, InvalidHashError):
            valid = False
        if not user or not valid or payload.username != user.username:
            if user:
                if user.locked_until and as_utc(user.locked_until) <= now:
                    user.failed_logins = 0
                user.failed_logins += 1
                if user.failed_logins >= 5:
                    user.locked_until = now + timedelta(minutes=15)
                db.commit()
            raise HTTPException(401, "Invalid username or password")
        user.failed_logins = 0
        user.locked_until = None
        if passwords.check_needs_rehash(user.password_hash):
            user.password_hash = passwords.hash(payload.password)
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        old_token = request.cookies.get(COOKIE_NAME)
        if old_token:
            db.execute(delete(Session).where(Session.token_hash == digest(old_token)))
        db.execute(delete(Session).where(Session.expires_at <= now))
        db.add(
            Session(
                token_hash=digest(token),
                user_id=user.id,
                csrf_token=csrf,
                expires_at=now + timedelta(seconds=SESSION_SECONDS),
            )
        )
        db.commit()
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=SESSION_SECONDS,
            httponly=True,
            secure=settings.secure_cookie,
            samesite="strict",
            path="/api",
        )
        return {"csrf_token": csrf, "username": user.username}

    @app.get("/api/v1/auth/session")
    def current_session(
        session: Session = Depends(authenticated), db: DBSession = Depends(database)
    ):
        return {
            "csrf_token": session.csrf_token,
            "username": db.get(HouseholdUser, session.user_id).username,
        }

    @app.post("/api/v1/auth/logout", status_code=204)
    def logout(
        response: Response,
        session: Session = Depends(authenticated),
        db: DBSession = Depends(database),
    ):
        db.delete(session)
        db.commit()
        response.delete_cookie(
            COOKIE_NAME,
            path="/api",
            secure=settings.secure_cookie,
            httponly=True,
            samesite="strict",
        )

    @app.get("/api/v1/travellers", response_model=list[TravellerView])
    def travellers(session: Session = Depends(authenticated), db: DBSession = Depends(database)):
        return db.scalars(select(Traveller).order_by(Traveller.slot)).all()

    @app.patch("/api/v1/travellers/{traveller_id}", response_model=TravellerView)
    def update_traveller(
        traveller_id: UUID,
        payload: TravellerUpdate,
        session: Session = Depends(authenticated),
        db: DBSession = Depends(database),
    ):
        traveller = db.scalar(
            select(Traveller).where(Traveller.id == traveller_id).with_for_update()
        )
        if traveller is None:
            raise HTTPException(404, "Traveller not found")
        if traveller.version != payload.version:
            raise HTTPException(409, "Profile changed in another window; refresh before saving")
        before = TravellerView.model_validate(traveller).model_dump(mode="json")
        for field, value in payload.model_dump(exclude={"version"}).items():
            setattr(traveller, field, value)
        if not payload.history_complete:
            traveller.history_reviewed_on = None
        elif not before["history_complete"]:
            traveller.history_reviewed_on = datetime.now(UTC).date()
        traveller.version += 1
        after = TravellerView.model_validate(traveller).model_dump(mode="json")
        db.add(
            AuditEvent(
                actor_id=session.user_id,
                entity="traveller",
                entity_id=traveller.id,
                operation="UPDATE",
                before_json=before,
                after_json=after,
            )
        )
        db.commit()
        return traveller

    app.include_router(travel_router(database, authenticated))
    return app
