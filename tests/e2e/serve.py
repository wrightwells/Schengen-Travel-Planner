"""Disposable development server for browser tests; never touches household data."""

import os
import sys
import tempfile
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))

from app.bootstrap import provision  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

with tempfile.TemporaryDirectory(prefix="schengen-e2e-") as directory:
    url = f"sqlite:///{directory}/test.db"
    os.environ["DATABASE_URL"] = url
    command.upgrade(Config(str(ROOT / "api/alembic.ini")), "head")
    with Session(create_engine(url)) as db:
        provision(db, "test-household", "test-only-household-password")
    app = create_app(Settings(url, secure_cookie=False))
    uvicorn.run(app, host="127.0.0.1", port=18080, access_log=False)
