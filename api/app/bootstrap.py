"""Interactive account provisioning; credentials never appear in command arguments."""

import getpass

from argon2 import PasswordHasher
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import HouseholdUser, Traveller


def provision(db: Session, username: str, password: str) -> None:
    if db.scalar(select(HouseholdUser)):
        raise ValueError("Household account already exists")
    username = username.strip()
    if not username or len(username) > 100:
        raise ValueError("Username must contain 1–100 characters")
    if len(password) < 12:
        raise ValueError("Use a password of at least 12 characters")
    db.add(HouseholdUser(username=username, password_hash=PasswordHasher().hash(password)))
    db.add_all(
        [
            Traveller(slot=1, display_name="Traveller A", rule_applicable=True),
            Traveller(slot=2, display_name="Traveller B", rule_applicable=True),
        ]
    )
    db.commit()


def main():
    settings = Settings.from_env()
    username = input("Household username: ")
    password = getpass.getpass("Password (at least 12 characters): ")
    if password != getpass.getpass("Confirm password: "):
        raise SystemExit("Passwords do not match")
    with Session(create_engine(settings.database_url)) as db:
        provision(db, username, password)
    print("Household created; standard rule enabled for both. History needs review.")


if __name__ == "__main__":
    main()
