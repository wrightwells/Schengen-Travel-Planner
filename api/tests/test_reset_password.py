import io
from datetime import UTC, datetime, timedelta

import pytest
from argon2 import PasswordHasher
from conftest import HEADERS, PASSWORD, sign_in
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.bootstrap import provision
from app.models import Base, HouseholdUser
from app.models import Session as LoginSession
from app.reset_password import main, reset_password

NEW_PASSWORD = "my-chosen-replacement-password"


def test_reset_replaces_password_unlocks_account_and_revokes_sessions(environment):
    client, engine = environment
    sign_in(client)
    profiles = client.get("/api/v1/travellers").json()
    with Session(engine) as db:
        user = db.scalar(select(HouseholdUser))
        user.failed_logins = 5
        user.locked_until = datetime.now(UTC) + timedelta(minutes=15)
        db.commit()
        reset_password(db, NEW_PASSWORD)
        assert user.username == "household"
        assert user.failed_logins == 0
        assert user.locked_until is None
        assert db.scalar(select(LoginSession)) is None
    assert client.get("/api/v1/travellers").status_code == 401
    assert (
        client.post(
            "/api/v1/auth/login",
            headers=HEADERS,
            json={"username": "household", "password": PASSWORD},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/auth/login",
            headers=HEADERS,
            json={"username": "household", "password": NEW_PASSWORD},
        ).status_code
        == 200
    )
    assert client.get("/api/v1/travellers").json() == profiles


def test_short_password_leaves_account_and_sessions_unchanged(environment):
    client, engine = environment
    sign_in(client)
    with Session(engine) as db:
        original_hash = db.scalar(select(HouseholdUser)).password_hash
        with pytest.raises(ValueError, match="at least 12"):
            reset_password(db, "short")
        assert db.scalar(select(HouseholdUser)).password_hash == original_hash
        assert db.scalar(select(LoginSession)) is not None
    assert client.get("/api/v1/travellers").status_code == 200


def test_reset_requires_existing_account():
    engine = create_engine("sqlite://")
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db, pytest.raises(ValueError, match="No household account"):
            reset_password(db, NEW_PASSWORD)
    finally:
        engine.dispose()


def test_command_reads_chosen_password_from_stdin(tmp_path, monkeypatch, capsys):
    url = f"sqlite:///{tmp_path / 'reset.db'}"
    engine = create_engine(url)
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            provision(db, "household", PASSWORD)
        monkeypatch.setenv("DATABASE_URL", url)
        monkeypatch.setattr("sys.argv", ["reset_password", "--password-stdin"])
        monkeypatch.setattr("sys.stdin", io.StringIO(NEW_PASSWORD + "\n"))
        main()
        output = capsys.readouterr().out
        assert "Household password reset" in output
        assert NEW_PASSWORD not in output
        with Session(engine) as db:
            assert PasswordHasher().verify(
                db.scalar(select(HouseholdUser)).password_hash, NEW_PASSWORD
            )
    finally:
        engine.dispose()


def test_command_rejects_mismatched_confirmation(monkeypatch):
    monkeypatch.setattr("sys.argv", ["reset_password"])
    prompts = iter([NEW_PASSWORD, "different-password"])
    monkeypatch.setattr("app.reset_password.getpass.getpass", lambda _: next(prompts))
    with pytest.raises(SystemExit, match="Passwords do not match"):
        main()
