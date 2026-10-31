import csv
from datetime import date
from io import StringIO
from uuid import uuid4

import pytest
from conftest import sign_in
from icalendar import Calendar
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_travel import draft

from app.models import AuditEvent, Trip
from app.services.exports import CSV_COLUMNS, calendar_text, spreadsheet_text


def events(response):
    assert response.status_code == 200, response.text
    calendar = Calendar.from_ical(response.content)
    assert calendar["version"] == "2.0"
    assert not calendar.errors
    result = calendar.walk("VEVENT")
    assert all(not event.errors for event in result)
    return result


def fixture(client, headers):
    a, b = client.get("/api/v1/travellers").json()
    history = draft(a["id"], "2028-02-28", "2028-03-01")
    history["title"] = 'Été, "France"; \\ trip'
    history["participants"][0]["segments"][0]["end_date"] = "2028-02-29"
    history["participants"][0]["segments"].append(
        {"country_code": "ES", "start_date": "2028-02-29", "end_date": "2028-03-01"}
    )
    history["participants"] += draft(b["id"], "2028-02-29", "2028-02-29", "GB")["participants"]
    saved = client.post("/api/v1/trips", headers=headers, json=history)
    assert saved.status_code == 201
    plan = client.post(
        "/api/v1/trips",
        headers=headers,
        json=draft(a["id"], "2028-05-01", "2028-05-10", status="PLANNED"),
    )
    assert plan.status_code == 201
    return a, b, history, saved.json(), plan.json()


def test_exports_are_private_bounded_to_supported_types_and_validate_traveller(environment):
    client, _ = environment
    for kind in ("history.csv", "history.ics", "plans.ics"):
        assert client.get(f"/api/v1/exports/{kind}").status_code == 401
        assert client.get(f"/api/v1/exports/{kind}?preview=true").status_code == 401
    sign_in(client)
    assert client.get("/api/v1/exports/plans.csv").status_code == 422
    assert client.get(f"/api/v1/exports/history.csv?traveller_id={uuid4()}").status_code == 404
    assert client.get("/api/v1/exports/history.ics?traveller_id=invalid").status_code == 422


def test_history_csv_roundtrips_utf8_quotes_segments_and_person_filter_without_writes(environment):
    client, engine = environment
    headers = sign_in(client)
    a, b, history, saved, _ = fixture(client, headers)
    profiles_before = client.get("/api/v1/travellers").json()
    with Session(engine) as db:
        audit_before = db.scalar(select(func.count()).select_from(AuditEvent))
    response = client.get("/api/v1/exports/history.csv?export_date=2026-10-29")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-disposition"] == (
        'attachment; filename="schengen-history-both-2026-10-29.csv"'
    )
    rows = list(csv.DictReader(StringIO(response.text, newline="")))
    assert tuple(rows[0]) == CSV_COLUMNS
    assert len(rows) == 3
    assert {r["trip_external_id"] for r in rows} == {saved["id"]}
    assert {r["trip_title"] for r in rows} == {history["title"]}
    assert {r["trip_status"] for r in rows} == {"HISTORY"}
    assert all(r["schema_version"] == "1" for r in rows)
    single = client.get(f"/api/v1/exports/history.csv?traveller_id={b['id']}")
    filtered = list(csv.DictReader(StringIO(single.text)))
    assert len(filtered) == 1
    assert filtered[0]["traveller_name"] == b["display_name"]
    assert filtered[0]["segment_start"] == filtered[0]["segment_end"] == "2028-02-29"
    assert filtered[0]["country_code"] == "GB"
    assert len(events(client.get(f"/api/v1/exports/history.ics?traveller_id={a['id']}"))) == 2
    assert client.get("/api/v1/travellers").json() == profiles_before
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(AuditEvent)) == audit_before
        assert db.scalar(select(func.count()).select_from(Trip)) == 2


def test_csv_formula_safety_for_titles_and_names(environment):
    client, _ = environment
    headers = sign_in(client)
    a = client.get("/api/v1/travellers").json()[0]
    payload = {
        k: a[k] for k in ("display_name", "rule_applicable", "history_complete", "notes", "version")
    }
    payload["display_name"] = "@SUM(1,2)"
    assert (
        client.patch(f"/api/v1/travellers/{a['id']}", headers=headers, json=payload).status_code
        == 200
    )
    history = draft(a["id"])
    history["title"] = '=HYPERLINK("example","demo")'
    assert client.post("/api/v1/trips", headers=headers, json=history).status_code == 201
    rows = list(csv.DictReader(StringIO(client.get("/api/v1/exports/history.csv").text)))
    assert rows[0]["traveller_name"] == "'@SUM(1,2)"
    assert rows[0]["trip_title"] == "'" + history["title"]
    for value in ("=1", "+1", "-1", "@SUM(1)", " \t=1", "\r=1", "\n=1", "\ttext"):
        assert spreadsheet_text(value) == "'" + value
    assert spreadsheet_text("O'Neil") == "O'Neil"


def test_ics_all_day_exclusive_dates_statuses_countries_and_separate_outputs(environment):
    client, _ = environment
    headers = sign_in(client)
    a, b, history, _, plan = fixture(client, headers)
    response = client.get("/api/v1/exports/history.ics")
    result = events(response)
    assert len(result) == 3
    assert len({str(e["uid"]) for e in result}) == 3
    assert {str(e["status"]) for e in result} == {"CONFIRMED"}
    assert {str(e["x-schengen-trip-status"]) for e in result} == {"HISTORY"}
    french = next(e for e in result if str(e["location"]) == "France")
    assert french.decoded("dtstart") == date(2028, 2, 28)
    assert french.decoded("dtend") == date(2028, 3, 1)
    assert french["dtstart"].params["VALUE"] == "DATE"
    assert history["title"] in str(french["summary"])
    assert a["display_name"] in str(french["description"])
    assert french.decoded("dtstamp").utcoffset().total_seconds() == 0
    british = next(e for e in result if str(e["location"]) == "United Kingdom")
    assert british.decoded("dtstart") == date(2028, 2, 29)
    assert british.decoded("dtend") == date(2028, 3, 1)
    assert b["display_name"] in str(british["description"])
    planned = events(client.get("/api/v1/exports/plans.ics"))
    assert len(planned) == 1
    assert str(planned[0]["status"]) == "TENTATIVE"
    assert "PLANNED" in str(planned[0]["description"])
    assert planned[0].decoded("dtend") == date(2028, 5, 11)
    assert plan["title"] in str(planned[0]["summary"])
    assert response.headers["content-type"] == "text/calendar; charset=utf-8"


def test_ics_escaping_multibyte_line_folding_and_uid_stability_on_rename_and_confirmation(
    environment,
):
    client, _ = environment
    headers = sign_in(client)
    a = client.get("/api/v1/travellers").json()[0]
    plan = draft(a["id"], "2028-12-31", "2028-12-31", status="PLANNED")
    plan["title"] = "旅é" * 50 + ",;\\\nEND:VEVENT"
    # Keep within the API's 150-character title limit while testing newlines and UTF-8.
    plan["title"] = plan["title"][:145]
    saved = client.post("/api/v1/trips", headers=headers, json=plan).json()
    response = client.get("/api/v1/exports/plans.ics")
    before = events(response)[0]
    assert plan["title"] in str(before["summary"])
    assert before.decoded("dtend") == date(2029, 1, 1)
    assert all(len(line) <= 75 for line in response.content.split(b"\r\n"))
    assert calendar_text("a\x00b\x1fc\x7fd\ne") == "abcd\ne"
    assert b"\r\n " in response.content
    assert b"\n" not in response.content.replace(b"\r\n", b"")
    renamed = {**plan, "title": "Renamed plan", "version": saved["version"]}
    updated = client.patch(f"/api/v1/trips/{saved['id']}", headers=headers, json=renamed).json()
    after = events(client.get("/api/v1/exports/plans.ics"))[0]
    assert after["uid"] == before["uid"]
    assert after["sequence"] > before["sequence"]
    confirmed = {**renamed, "status": "HISTORY", "version": updated["version"]}
    response = client.post(f"/api/v1/trips/{saved['id']}/confirm", headers=headers, json=confirmed)
    assert response.status_code == 200
    assert events(client.get("/api/v1/exports/plans.ics")) == []
    historical = events(client.get("/api/v1/exports/history.ics"))[0]
    assert historical["uid"] == before["uid"]
    assert historical["sequence"] > after["sequence"]


@pytest.mark.parametrize("kind", ["history.csv", "history.ics", "plans.ics"])
def test_empty_export_preview_and_snapshot_content(environment, kind):
    client, _ = environment
    sign_in(client)
    response = client.get(f"/api/v1/exports/{kind}?preview=true&export_date=2026-10-29")
    assert response.status_code == 200
    preview = response.json()
    assert preview["row_count"] == preview["trip_count"] == 0
    assert preview["rows"] == []
    assert "2026-10-29" in preview["filename"]
    assert preview["content"].startswith(
        "schema_version" if kind.endswith("csv") else "BEGIN:VCALENDAR"
    )
    if kind.endswith("csv"):
        assert preview["content"] == client.get(f"/api/v1/exports/{kind}").text


def test_preview_contains_all_content_but_caps_visible_rows(environment):
    client, _ = environment
    headers = sign_in(client)
    a = client.get("/api/v1/travellers").json()[0]
    # 51 adjacent one-day country segments in one participant, split over two trips.
    from datetime import timedelta

    for offset, count in ((0, 30), (30, 21)):
        start = date(2026, 1, 1) + timedelta(days=offset)
        end = start + timedelta(days=count - 1)
        history = draft(a["id"], start.isoformat(), end.isoformat())
        history["participants"][0]["segments"] = [
            {
                "country_code": "FR",
                "start_date": (start + timedelta(days=i)).isoformat(),
                "end_date": (start + timedelta(days=i)).isoformat(),
            }
            for i in range(count)
        ]
        assert client.post("/api/v1/trips", headers=headers, json=history).status_code == 201
    preview = client.get("/api/v1/exports/history.csv?preview=true").json()
    assert preview["row_count"] == 51
    assert len(preview["rows"]) == 50
    assert preview["trip_count"] == 2
    assert len(list(csv.DictReader(StringIO(preview["content"])))) == 51
    assert preview["content"] == client.get("/api/v1/exports/history.csv").text
