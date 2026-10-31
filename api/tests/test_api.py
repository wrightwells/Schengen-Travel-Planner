from datetime import UTC, datetime, timedelta

import pytest
from conftest import HEADERS, PASSWORD, sign_in
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.pool import StaticPool

from app.bootstrap import provision
from app.config import Settings
from app.main import create_app
from app.models import AuditEvent, Base, Session, Traveller


def test_data_requires_auth_and_login_requires_custom_header(environment):
    client, _ = environment
    assert client.get("/api/v1/travellers").status_code == 401
    assert (
        client.post(
            "/api/v1/auth/login", json={"username": "household", "password": PASSWORD}
        ).status_code
        == 403
    )


def test_profiles_start_with_standard_rule_and_unconfirmed_history(environment):
    client, _ = environment
    sign_in(client)
    profiles = client.get("/api/v1/travellers").json()
    assert [p["display_name"] for p in profiles] == ["Traveller A", "Traveller B"]
    assert all(p["rule_applicable"] is True and not p["history_complete"] for p in profiles)


def test_name_edit_persists_and_is_audited_with_optimistic_conflict(environment):
    client, engine = environment
    headers = sign_in(client)
    profile = client.get("/api/v1/travellers").json()[0]
    payload = {
        key: profile[key]
        for key in ("display_name", "rule_applicable", "history_complete", "notes", "version")
    }
    payload["display_name"] = "Alex"
    url = f"/api/v1/travellers/{profile['id']}"
    assert client.patch(url, headers=HEADERS, json=payload).status_code == 403
    updated = client.patch(url, headers=headers, json=payload)
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "Alex"
    assert updated.json()["version"] == 2
    assert client.patch(url, headers=headers, json=payload).status_code == 409
    with DBSession(engine) as db:
        assert db.scalar(select(Traveller).where(Traveller.slot == 1)).display_name == "Alex"
        audit = db.scalar(select(AuditEvent))
        assert audit.before_json["display_name"] == "Traveller A"
        assert audit.after_json["display_name"] == "Alex"
        assert "password" not in str(audit.after_json)


def test_logout_revokes_server_session(environment):
    client, engine = environment
    headers = sign_in(client)
    stolen = client.cookies.get("schengen_session")
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    client.cookies.set("schengen_session", stolen)
    assert client.get("/api/v1/travellers").status_code == 401
    with DBSession(engine) as db:
        assert db.scalar(select(Session)) is None


def test_expired_session_rejected(environment):
    client, engine = environment
    sign_in(client)
    with DBSession(engine) as db:
        db.scalar(select(Session)).expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/v1/travellers").status_code == 401


def test_login_throttle_cannot_be_bypassed_by_unknown_name(environment):
    client, _ = environment
    for _ in range(5):
        response = client.post(
            "/api/v1/auth/login",
            headers=HEADERS,
            json={"username": "someone_else", "password": "invalid"},
        )
        assert response.status_code == 401
    assert (
        client.post(
            "/api/v1/auth/login",
            headers=HEADERS,
            json={"username": "household", "password": PASSWORD},
        ).status_code
        == 429
    )


def test_second_household_cannot_be_provisioned(environment):
    _, engine = environment
    with DBSession(engine) as db, pytest.raises(ValueError, match="already exists"):
        provision(db, "another", PASSWORD)


def test_oversized_request_and_invalid_host_rejected(environment):
    client, _ = environment
    assert (
        client.post("/api/v1/auth/login", headers=HEADERS, content="x" * 20_000).status_code == 413
    )
    assert (
        client.get("/api/v1/health/live", headers={"Host": "untrusted.example"}).status_code == 400
    )


def test_secure_cookie_default():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with DBSession(engine) as db:
        provision(db, "household", PASSWORD)
    with TestClient(
        create_app(Settings("sqlite://", allowed_hosts=("testserver",)), engine=engine),
        base_url="https://testserver",
    ) as client:
        sign_in(client)
        cookie = client.cookies.jar._cookies["testserver.local"]["/api"]["schengen_session"]
        assert cookie.secure
        assert cookie.has_nonstandard_attr("HttpOnly")
    engine.dispose()
