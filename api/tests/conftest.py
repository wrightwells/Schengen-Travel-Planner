import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.pool import StaticPool

from app.bootstrap import provision
from app.catalogue import seed_catalogue
from app.config import Settings
from app.main import create_app
from app.models import Base

HEADERS = {"X-Requested-With": "SchengenPlanner"}
PASSWORD = "a-test-household-password"


@pytest.fixture
def environment():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        seed_catalogue(connection)
    with DBSession(engine) as db:
        provision(db, "household", PASSWORD)
    app = create_app(
        Settings("sqlite://", secure_cookie=False, allowed_hosts=("testserver",)), engine=engine
    )
    with TestClient(app) as client:
        yield client, engine
    engine.dispose()


def sign_in(client):
    response = client.post(
        "/api/v1/auth/login", headers=HEADERS, json={"username": "household", "password": PASSWORD}
    )
    assert response.status_code == 200
    return {**HEADERS, "X-CSRF-Token": response.json()["csrf_token"]}
