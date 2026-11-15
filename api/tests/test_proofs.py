import json
import os
import stat
from uuid import UUID, uuid4

import pytest
from conftest import HEADERS, sign_in
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_travel import draft

from app.models import Trip
from app.services.proofs import MAX_PROOF_BYTES, ProofStorage

PDF = b"%PDF-1.7\nproof-of-travel\n%%EOF\n"


def history(environment, *, status="HISTORY", start="2026-01-01", end="2026-01-10"):
    client, engine = environment
    headers = sign_in(client)
    traveller = client.get("/api/v1/travellers").json()[0]["id"]
    payload = draft(traveller, start=start, end=end, status=status)
    response = client.post("/api/v1/trips", headers=headers, json=payload)
    assert response.status_code == 201
    trip = response.json()
    return client, engine, headers, trip, f"/api/v1/trips/{trip['id']}/proofs"


def upload(client, path, headers, content=PDF, filename="ticket.pdf"):
    return client.post(
        path,
        params={"filename": filename},
        content=content,
        headers={**headers, "Content-Type": "application/octet-stream"},
    )


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("ticket.pdf", PDF),
        ("boarding.png", b"\x89PNG\r\n\x1a\nexample"),
        ("stamp.jpeg", b"\xff\xd8\xffexample"),
    ],
)
def test_proofs_round_trip_privately_on_disk(environment, tmp_path, filename, content):
    client, engine, headers, trip, path = history(environment)
    response = upload(client, path, headers, content, filename)
    assert response.status_code == 201, response.text
    proof = response.json()
    assert proof["size"] == len(content)
    assert proof["filename"] == filename
    assert client.get(path).json() == [proof]
    download = client.get(f"{path}/{proof['id']}")
    assert download.status_code == 200
    assert download.content == content
    assert download.headers["content-type"] == "application/octet-stream"
    assert download.headers["content-disposition"] == f'attachment; filename="{filename}"'
    assert download.headers["cache-control"] == "no-store"
    assert download.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in download.headers["content-security-policy"]
    root = tmp_path / "proofs"
    directory = root / trip["id"]
    stored = directory / f"{proof['id']}.proof"
    assert stat.S_IMODE(root.stat().st_mode) == 0o700
    assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    assert stat.S_IMODE(stored.stat().st_mode) == 0o600
    metadata, body = stored.read_bytes().split(b"\n", 1)
    assert json.loads(metadata) == proof
    assert body == content
    # Saving a document does not change the trip or its version.
    with Session(engine) as db:
        assert db.scalar(select(Trip)).version == trip["version"]
    client.cookies.clear()
    assert client.get(path).status_code == 401
    assert client.get(f"{path}/{proof['id']}").status_code == 401
    assert upload(client, path, headers).status_code == 401
    assert client.delete(f"{path}/{proof['id']}", headers=headers).status_code == 401


def test_csrf_required_for_upload_and_removal(environment):
    client, _, headers, _, path = history(environment)
    assert upload(client, path, HEADERS).status_code == 403
    assert upload(client, path, {}).status_code == 403
    proof = upload(client, path, headers).json()
    assert client.delete(f"{path}/{proof['id']}", headers=HEADERS).status_code == 403
    assert client.get(f"{path}/{proof['id']}").content == PDF


def test_proof_removal_and_trip_deletion_remove_files(environment, tmp_path):
    client, _, headers, trip, path = history(environment)
    first = upload(client, path, headers).json()
    second = upload(client, path, headers).json()
    assert client.delete(f"{path}/{first['id']}", headers=headers).status_code == 204
    assert client.get(f"{path}/{first['id']}").status_code == 404
    assert client.get(path).json() == [second]
    assert (
        client.delete(
            f"/api/v1/trips/{trip['id']}?version={trip['version']}", headers=headers
        ).status_code
        == 204
    )
    assert client.get(f"{path}/{second['id']}").status_code == 404
    assert list((tmp_path / "proofs" / trip["id"]).iterdir()) == []


def test_proofs_are_scoped_to_existing_history(environment):
    client, _, headers, _, path = history(environment)
    proof = upload(client, path, headers).json()
    traveller = client.get("/api/v1/travellers").json()[0]["id"]
    other = client.post(
        "/api/v1/trips",
        headers=headers,
        json=draft(traveller, start="2026-02-01", end="2026-02-10"),
    ).json()
    other_path = f"/api/v1/trips/{other['id']}/proofs/{proof['id']}"
    assert client.get(other_path).status_code == 404
    assert client.delete(other_path, headers=headers).status_code == 404
    missing = f"/api/v1/trips/{uuid4()}/proofs"
    assert client.get(missing).status_code == 404
    assert upload(client, missing, headers).status_code == 404
    assert client.get(f"{path}/not-a-uuid").status_code == 422
    assert client.get(f"/proofs/{other['id']}/{proof['id']}.proof").status_code == 404


def test_plans_cannot_have_proofs(environment):
    client, _, headers, _, path = history(environment, status="PLANNED")
    assert upload(client, path, headers).status_code == 409
    assert client.get(path).status_code == 409
    assert client.get(f"{path}/{uuid4()}").status_code == 409


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("malware.pdf", b"<html><script>alert(1)</script></html>"),
        ("ticket.exe", PDF),
        ("ticket.jpg", PDF),
        ("ticket.pdf", b"MZexecutable"),
    ],
)
def test_rejects_unsupported_or_mismatched_document_types(environment, filename, content):
    client, _, headers, _, path = history(environment)
    assert upload(client, path, headers, content, filename).status_code == 415
    assert client.get(path).json() == []


def test_upload_limit_and_ordinary_request_limits(environment):
    client, _, headers, _, path = history(environment)
    assert upload(client, path, headers, PDF + b" " * MAX_PROOF_BYTES).status_code == 413
    assert client.post("/api/v1/trips", headers=headers, content=b" " * 16385).status_code == 413
    content = PDF + b" " * (MAX_PROOF_BYTES - len(PDF))
    assert upload(client, path, headers, content).status_code == 201


def test_client_filename_never_becomes_storage_path(environment, tmp_path):
    client, _, headers, trip, path = history(environment)
    response = upload(client, path, headers, filename="../../private\\boarding\r\npass.pdf")
    assert response.status_code == 201
    proof = response.json()
    assert proof["filename"] == "boarding__pass.pdf"
    stored = list((tmp_path / "proofs" / trip["id"]).iterdir())
    assert [item.name for item in stored] == [f"{proof['id']}.proof"]
    assert "\r" not in client.get(f"{path}/{proof['id']}").headers["content-disposition"]


def test_per_trip_document_limit(environment, tmp_path):
    client, _, headers, trip, path = history(environment)
    storage = ProofStorage(str(tmp_path / "proofs"))
    for _ in range(20):
        storage.save(UUID(trip["id"]), "ticket.pdf", PDF)
    assert upload(client, path, headers).status_code == 409
    assert len(client.get(path).json()) == 20


@pytest.mark.parametrize("target", ["root", "ancestor", "trip", "file", "hardlink"])
def test_storage_refuses_symlinks_and_hardlinks(tmp_path, target):
    storage = ProofStorage(str(tmp_path / "proofs"))
    trip_id = uuid4()
    proof = storage.save(trip_id, "ticket.pdf", PDF)
    root = tmp_path / "proofs"
    directory = root / str(trip_id)
    stored = directory / f"{proof['id']}.proof"
    if target == "root":
        root.rename(tmp_path / "real-root")
        root.symlink_to(tmp_path / "real-root", target_is_directory=True)
    elif target == "ancestor":
        alias = tmp_path / "alias"
        alias.symlink_to(tmp_path, target_is_directory=True)
        storage = ProofStorage(str(alias / "proofs"))
    elif target == "trip":
        directory.rename(root / "real-trip")
        directory.symlink_to(root / "real-trip", target_is_directory=True)
    elif target == "file":
        stored.rename(directory / "original")
        stored.symlink_to(directory / "original")
    else:
        os.link(stored, directory / "extra-link")
    with pytest.raises(HTTPException) as error:
        storage.download(trip_id, UUID(proof["id"]))
    assert error.value.status_code == 503
    assert str(tmp_path) not in error.value.detail


@pytest.mark.parametrize("target", ["root", "trip", "file"])
def test_storage_fails_closed_for_unsafe_permissions(tmp_path, target):
    storage = ProofStorage(str(tmp_path / "proofs"))
    trip_id = uuid4()
    proof = storage.save(trip_id, "ticket.pdf", PDF)
    root = tmp_path / "proofs"
    directory = root / str(trip_id)
    stored = directory / f"{proof['id']}.proof"
    {"root": root, "trip": directory, "file": stored}[target].chmod(0o777)
    with pytest.raises(HTTPException) as error:
        storage.download(trip_id, UUID(proof["id"]))
    assert error.value.status_code == 503


def test_interrupted_write_does_not_publish_document(tmp_path, monkeypatch):
    storage = ProofStorage(str(tmp_path / "proofs"))
    trip_id = uuid4()

    def failed_rename(*args, **kwargs):
        raise OSError("Disk failure")

    monkeypatch.setattr("app.services.proofs.os.rename", failed_rename)
    with pytest.raises(HTTPException) as error:
        storage.save(trip_id, "ticket.pdf", PDF)
    assert error.value.status_code == 503
    assert storage.list(trip_id) == []
    assert list((tmp_path / "proofs" / str(trip_id)).iterdir()) == []
