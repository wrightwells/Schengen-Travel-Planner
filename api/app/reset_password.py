"""Reset the household password from an interactive prompt or standard input."""

import argparse
import getpass
import sys

from argon2 import PasswordHasher
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import HouseholdUser
from app.models import Session as LoginSession


def reset_password(db: Session, password: str) -> None:
    if len(password) < 12:
        raise ValueError("Use a password of at least 12 characters")
    user = db.scalar(select(HouseholdUser).with_for_update())
    if user is None:
        raise ValueError("No household account exists; run python -m app.bootstrap first")
    user.password_hash = PasswordHasher().hash(password)
    user.failed_logins = 0
    user.locked_until = None
    db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    db.commit()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read the chosen password from one line of stdin",
    )
    args = parser.parse_args()
    if args.password_stdin:
        password = sys.stdin.readline().removesuffix("\n").removesuffix("\r")
    else:
        password = getpass.getpass("New password (at least 12 characters): ")
        if password != getpass.getpass("Confirm new password: "):
            raise SystemExit("Passwords do not match; password unchanged")
    engine = create_engine(Settings.from_env().database_url)
    try:
        with Session(engine) as db:
            reset_password(db, password)
    except ValueError as exc:
        raise SystemExit(str(exc)) from None
    finally:
        engine.dispose()
    print("Household password reset; login lockout cleared and existing sessions signed out.")


if __name__ == "__main__":
    main()
