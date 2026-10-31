import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    secure_cookie: bool = True
    allowed_hosts: tuple[str, ...] = ("localhost", "127.0.0.1")

    @classmethod
    def from_env(cls):
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL is required; run migrations before starting the API")
        return cls(
            database_url=url,
            secure_cookie=os.environ.get("COOKIE_SECURE", "true").lower() != "false",
            allowed_hosts=tuple(os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")),
        )
