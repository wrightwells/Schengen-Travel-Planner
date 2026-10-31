import csv
from io import StringIO
from uuid import uuid4

from conftest import HEADERS, sign_in
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AuditEvent, Trip
from app.services.exports import CSV_COLUMNS

PREVIEW = "/api/v1/imports/history/preview"
COMMIT = "/api/v1/imports/history/commit"


def document(
    name, *, key=None, title="Imported, été", start="2026-05-01", end="2026-05-10", country="FR"
):
    return ["1", key or str(uuid4()), name, title, country, start, end, "HISTORY"]


def request(rows, mapping=None):
    out = StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)
    writer.writerows(rows)
    return {"content": out.getvalue(), "traveller_mapping": mapping or {}}


def prepare(client, headers, body):
    result = client.post(PREVIEW, headers=headers, json=body)
    assert result.status_code == 200, result.text
    return result.json()


def commit(client, headers, body, preview, actions=None):
    return client.post(
        COMMIT,
        headers=headers,
        json={
            **body,
            "preview_token": preview["preview_token"],
            "decisions": actions
            or {
                e["key"]: "import" if e["state"] == "ready" else "skip" for e in preview["entries"]
            },
        },
    )


def test_import_security_size_and_malformed_csv(environment):
    client, _ = environment
    body = request([])
    assert client.post(PREVIEW, headers=HEADERS, json=body).status_code == 401
    headers = sign_in(client)
    assert client.post(PREVIEW, headers=HEADERS, json=body).status_code == 403
    assert client.post(COMMIT, headers=HEADERS, json={}).status_code == 403
    assert (
        client.post(PREVIEW, headers=headers, json={"content": "wrong,headers\n"}).status_code
        == 422
    )
    assert client.post(PREVIEW, headers=headers, json={"content": "x" * 512001}).status_code == 422
    assert client.post(PREVIEW, headers=headers, content=b"x" * 1048577).status_code == 413
    body = request([document("A")])
    body["content"] += '"unterminated'
    assert client.post(PREVIEW, headers=headers, json=body).status_code == 422
    empty = prepare(client, headers, request([]))
    assert empty["entries"] == []


def test_mapping_shared_multicountry_preview_no_writes_and_roundtrip(environment):
    client, engine = environment
    headers = sign_in(client)
    a, b = client.get("/api/v1/travellers").json()
    key = str(uuid4())
    body = request(
        [
            document("Old A", key=key, end="2026-05-05"),
            document("Old A", key=key, start="2026-05-05", country="ES"),
            document("Old B", key=key, start="2026-05-03", end="2026-05-04", country="GB"),
        ]
    )
    preview = prepare(client, headers, body)
    assert preview["entries"][0]["state"] == "invalid"
    body["traveller_mapping"] = {"Old A": a["id"], "Old B": b["id"]}
    before = client.get("/api/v1/travellers").json()
    preview = prepare(client, headers, body)
    assert preview["entries"][0]["state"] == "ready"
    assert client.get("/api/v1/trips").json() == []
    assert client.get("/api/v1/travellers").json() == before
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(AuditEvent)) == 0
    result = commit(client, headers, body, preview)
    assert result.status_code == 200, result.text
    assert result.json()["imported_count"] == 1
    saved = client.get("/api/v1/trips").json()[0]
    assert saved["id"] == key
    assert len(saved["participants"]) == 2
    assert sorted(p["schengen_days"] for p in saved["participants"]) == [0, 10]
    assert all(
        p["version"] == 2 and not p["history_complete"]
        for p in client.get("/api/v1/travellers").json()
    )
    # Lost commit response/retry never creates a duplicate.
    assert commit(client, headers, body, preview).status_code == 409
    exported = {"content": client.get("/api/v1/exports/history.csv").text}
    duplicate = prepare(client, headers, exported)
    assert duplicate["entries"][0]["state"] == "duplicate"
    assert commit(client, headers, exported, duplicate).json()["imported_count"] == 0
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(AuditEvent)) == 1


def test_stale_tampered_and_cross_session_previews(environment):
    client, _ = environment
    headers = sign_in(client)
    a = client.get("/api/v1/travellers").json()[0]
    body = request([document(a["display_name"])])
    preview = prepare(client, headers, body)
    changed = request(
        [document(a["display_name"], key=preview["entries"][0]["key"], title="Tampered")]
    )
    assert commit(client, headers, changed, preview).status_code == 409
    forged = {**preview, "preview_token": "0." + "a" * 64}
    assert commit(client, headers, body, forged).status_code == 409
    changed_profile = {
        k: a[k] for k in ("display_name", "version", "rule_applicable", "history_complete", "notes")
    }
    changed_profile["display_name"] = "Renamed"
    assert (
        client.patch(
            f"/api/v1/travellers/{a['id']}", headers=headers, json=changed_profile
        ).status_code
        == 200
    )
    assert commit(client, headers, body, preview).status_code == 409
    new_headers = sign_in(client)
    assert commit(client, new_headers, body, preview).status_code == 409
    assert client.get("/api/v1/trips").json() == []


def test_validation_conflicts_and_explicit_skip(environment):
    client, _ = environment
    headers = sign_in(client)
    a = client.get("/api/v1/travellers").json()[0]
    name = a["display_name"]
    bad = [
        document(name, start="01/05/2026"),
        document(name, country="ZZ"),
        document(name, end="2026-04-30"),
        document(name, start="2026-02-29"),
    ]
    good = document(name)
    body = request([*bad, good])
    preview = prepare(client, headers, body)
    assert [e["state"] for e in preview["entries"]] == ["invalid"] * 4 + ["ready"]
    assert commit(client, headers, body, preview).json()["imported_count"] == 1
    conflict = request([document(name, country="ES")])
    preview = prepare(client, headers, conflict)
    assert preview["entries"][0]["state"] == "conflict"
    assert (
        commit(
            client, headers, conflict, preview, {preview["entries"][0]["key"]: "import"}
        ).status_code
        == 422
    )
    assert commit(client, headers, conflict, preview).json()["imported_count"] == 0
    # A duplicate segment is an invalid itinerary, not an unnoticed second row.
    row = document(name, start="2027-05-01", end="2027-05-03")
    assert prepare(client, headers, request([row, row]))["entries"][0]["state"] == "invalid"


def test_batch_rollback_including_audits_and_reviews(environment):
    client, engine = environment
    headers = sign_in(client)
    a = client.get("/api/v1/travellers").json()[0]
    body = request([document(a["display_name"]), document(a["display_name"], country="ES")])
    preview = prepare(client, headers, body)
    assert all(e["state"] == "ready" for e in preview["entries"])
    assert "Overlaps CSV trip" in preview["entries"][0]["message"]
    assert commit(client, headers, body, preview).status_code == 409
    assert client.get("/api/v1/travellers").json()[0] == a
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Trip)) == 0
        assert db.scalar(select(func.count()).select_from(AuditEvent)) == 0
    # Explicitly skip the alternative and the same unchanged preview can commit.
    actions = {e["key"]: "import" if i == 0 else "skip" for i, e in enumerate(preview["entries"])}
    assert commit(client, headers, body, preview, actions).json()["imported_count"] == 1


def test_explicit_replacement_and_filtered_shared_trip_protection(environment):
    client, _ = environment
    headers = sign_in(client)
    a, b = client.get("/api/v1/travellers").json()
    key = str(uuid4())
    body = request([document(a["display_name"], key=key), document(b["display_name"], key=key)])
    assert commit(client, headers, body, prepare(client, headers, body)).status_code == 200
    original = client.get("/api/v1/trips").json()[0]
    original_ids = {s["id"] for p in original["participants"] for s in p["segments"]}
    partial = request([document(a["display_name"], key=key, title="Changed")])
    assert prepare(client, headers, partial)["entries"][0]["allowed_actions"] == ["skip"]
    replacement = request(
        [
            document(a["display_name"], key=key, title="Changed"),
            document(b["display_name"], key=key, title="Changed"),
        ]
    )
    preview = prepare(client, headers, replacement)
    assert preview["entries"][0]["allowed_actions"] == ["skip", "replace"]
    assert preview["entries"][0]["existing_trip"]["title"] == "Imported, été"
    assert commit(client, headers, replacement, preview, {key: "replace"}).status_code == 200
    saved = client.get("/api/v1/trips").json()
    assert len(saved) == 1 and saved[0]["title"] == "Changed" and saved[0]["version"] == 2
    assert {s["id"] for p in saved[0]["participants"] for s in p["segments"]} == original_ids


def test_bom_formula_protection_mapping_ambiguity_and_strict_columns(environment):
    client, _ = environment
    headers = sign_in(client)
    a, b = client.get("/api/v1/travellers").json()
    body = request([document("External", title="'=SUM(1,2)")], {"External": a["id"]})
    body["content"] = "\ufeff" + body["content"]
    preview = prepare(client, headers, body)
    assert preview["entries"][0]["trip"]["title"] == "=SUM(1,2)"
    assert commit(client, headers, body, preview).status_code == 200
    exported = {"content": client.get("/api/v1/exports/history.csv").text}
    assert prepare(client, headers, exported)["entries"][0]["state"] == "duplicate"
    body = request(
        [document("External"), document("Other", key=str(uuid4()))], {"External": str(uuid4())}
    )
    assert client.post(PREVIEW, headers=headers, json=body).status_code == 422
    same = document("External")
    other = document("Other", key=same[1], country="ES")
    body = request([same, other], {"External": a["id"], "Other": a["id"]})
    assert prepare(client, headers, body)["entries"][0]["state"] == "invalid"


def test_export_import_preserves_literal_leading_apostrophes(environment):
    from test_travel import draft

    client, _ = environment
    headers = sign_in(client)
    person = client.get("/api/v1/travellers").json()[0]
    for index, title in enumerate(("'=SUM(1,2)", "'holiday", "''quoted")):
        payload = draft(person["id"], f"2026-0{index + 1}-01", f"2026-0{index + 1}-02")
        payload["title"] = title
        assert client.post("/api/v1/trips", headers=headers, json=payload).status_code == 201
    body = {"content": client.get("/api/v1/exports/history.csv").text}
    preview = prepare(client, headers, body)
    assert len(preview["entries"]) == 3
    assert all(entry["state"] == "duplicate" for entry in preview["entries"])
