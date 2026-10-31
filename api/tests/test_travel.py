from copy import deepcopy
from uuid import uuid4

from conftest import HEADERS, sign_in
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalogue import COVERAGE_START
from app.models import AuditEvent, Membership, Trip
from app.services.travel import Catalogue
from app.travel_schemas import SegmentInput


def household(environment):
    client, engine = environment
    headers = sign_in(client)
    profiles = client.get("/api/v1/travellers").json()
    return client, engine, headers, profiles


def draft(traveller_id, start="2026-01-01", end="2026-01-10", code="FR", status="HISTORY"):
    return {
        "title": "A recorded journey",
        "status": status,
        "participants": [
            {
                "traveller_id": traveller_id,
                "entry_date": start,
                "exit_date": end,
                "segments": [{"country_code": code, "start_date": start, "end_date": end}],
            }
        ],
    }


def review(client, headers, profile):
    data = {
        key: profile[key]
        for key in ("display_name", "rule_applicable", "history_complete", "notes", "version")
    }
    data["history_complete"] = True
    response = client.patch(f"/api/v1/travellers/{profile['id']}", headers=headers, json=data)
    assert response.status_code == 200, response.text
    return response.json()


def test_catalogue_is_private_searchable_and_date_aware(environment):
    client, engine = environment
    assert client.get("/api/v1/countries").status_code == 401
    sign_in(client)
    countries = client.get("/api/v1/countries?query=rom").json()["countries"]
    assert [item["code"] for item in countries] == ["RO"]
    assert countries[0]["memberships"][1]["effective_from"] == "2024-03-31"
    with Session(engine) as db:
        catalogue = Catalogue(db)
        for code, start, end, count in [
            ("HR", "2022-12-30", "2023-01-02", 2),
            ("BG", "2024-03-30", "2024-04-01", 2),
            ("RO", "2024-03-30", "2024-04-01", 2),
            ("GB", "2026-01-01", "2026-01-10", 0),
            ("GF", "2026-01-01", "2026-01-10", 0),
        ]:
            assert (
                len(
                    catalogue.presence(
                        [SegmentInput(country_code=code, start_date=start, end_date=end)]
                    )
                )
                == count
            )
        for intervals in catalogue.memberships.values():
            assert intervals[0].effective_from == COVERAGE_START
            assert intervals[-1].effective_to is None
            for a, b in zip(intervals, intervals[1:], strict=False):
                assert (b.effective_from - a.effective_to).days == 1
        assert (
            db.scalar(
                select(func.count()).select_from(Membership).where(Membership.is_schengen.is_(True))
            )
            == 29
        )


def test_shared_trip_distinct_dates_filters_and_neutral_days(environment):
    client, _, headers, profiles = household(environment)
    payload = draft(profiles[0]["id"])
    payload["participants"].extend(
        draft(profiles[1]["id"], end="2026-01-03", code="GB")["participants"]
    )
    response = client.post("/api/v1/trips", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    saved = response.json()
    counts = {p["traveller_id"]: p["schengen_days"] for p in saved["participants"]}
    assert counts == {profiles[0]["id"]: 10, profiles[1]["id"]: 0}
    assert len(client.get(f"/api/v1/trips?traveller_id={profiles[1]['id']}&country=GB").json()) == 1
    assert client.get("/api/v1/trips?status=PLANNED").json() == []
    assert client.get("/api/v1/trips?start=2027-01-01").json() == []
    assert client.get(f"/api/v1/trips/{saved['id']}").json()["id"] == saved["id"]


def test_edit_delete_versions_audit_and_history_review_invalidation(environment):
    client, engine, headers, profiles = household(environment)
    payload = draft(profiles[0]["id"])
    saved = client.post("/api/v1/trips", headers=headers, json=payload).json()
    current = client.get("/api/v1/travellers").json()[0]
    review(client, headers, current)
    payload["version"] = saved["version"]
    payload["title"] = "Corrected title"
    url = f"/api/v1/trips/{saved['id']}"
    assert client.patch(url, headers=HEADERS, json=payload).status_code == 403
    updated = client.patch(url, headers=headers, json=payload)
    assert updated.status_code == 200, updated.text
    assert (
        updated.json()["participants"][0]["segments"][0]["id"]
        == saved["participants"][0]["segments"][0]["id"]
    )
    assert not client.get("/api/v1/travellers").json()[0]["history_complete"]
    assert client.patch(url, headers=headers, json=payload).status_code == 409
    assert client.delete(url + "?version=1", headers=headers).status_code == 409
    assert client.delete(url + "?version=2", headers=headers).status_code == 204
    assert client.get(url).status_code == 404
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Trip)) == 0
        operations = db.scalars(
            select(AuditEvent.operation)
            .where(AuditEvent.entity == "trip")
            .order_by(AuditEvent.occurred_at)
        ).all()
        assert operations == ["CREATE", "UPDATE", "DELETE"]


def test_overlap_validation_allows_only_single_day_cross_border_transitions(environment):
    client, engine, headers, profiles = household(environment)
    payload = draft(profiles[0]["id"])
    participant = payload["participants"][0]
    participant["segments"] = [
        {"country_code": "FR", "start_date": "2026-01-01", "end_date": "2026-01-05"},
        {"country_code": "ES", "start_date": "2026-01-05", "end_date": "2026-01-10"},
    ]
    saved = client.post("/api/v1/trips", headers=headers, json=payload)
    assert saved.status_code == 201
    assert saved.json()["participants"][0]["schengen_days"] == 10
    duplicate = client.post("/api/v1/trips", headers=headers, json=payload)
    assert duplicate.status_code == 409
    bad = deepcopy(payload)
    bad["participants"][0]["segments"][1]["start_date"] = "2026-01-04"
    assert client.post("/api/v1/trips", headers=headers, json=bad).status_code == 422
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Trip)) == 1


def test_invalid_itineraries_do_not_partially_save(environment):
    client, engine, headers, profiles = household(environment)
    for kind in (
        "unknown-country",
        "unknown-traveller",
        "duplicate-person",
        "gap",
        "backwards",
        "outside",
    ):
        payload = draft(profiles[0]["id"])
        participant = payload["participants"][0]
        if kind == "unknown-country":
            participant["segments"][0]["country_code"] = "ZZ"
        if kind == "unknown-traveller":
            participant["traveller_id"] = str(uuid4())
        if kind == "duplicate-person":
            payload["participants"].append(deepcopy(participant))
        if kind == "gap":
            participant["segments"][0]["end_date"] = "2026-01-09"
        if kind == "backwards":
            participant["exit_date"] = "2025-12-31"
        if kind == "outside":
            participant["segments"][0]["start_date"] = "2025-12-31"
        result = client.post("/api/v1/trips", headers=headers, json=payload)
        assert result.status_code == 422, (kind, result.text)
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Trip)) == 0


def test_plans_are_explicitly_included_and_self_excluded(environment):
    client, _, headers, profiles = household(environment)
    a = profiles[0]["id"]
    assert (
        client.post("/api/v1/trips", headers=headers, json=draft(a, end="2026-03-26")).status_code
        == 201
    )  # 85 days
    for profile in client.get("/api/v1/travellers").json():
        review(client, headers, profile)
    plan = client.post(
        "/api/v1/trips",
        headers=headers,
        json=draft(a, "2026-04-01", "2026-04-05", status="PLANNED"),
    ).json()
    payload = {"candidate": draft(a, "2026-04-10", "2026-04-14", status="PLANNED")}
    base = client.post("/api/v1/eligibility/evaluate", headers=headers, json=payload)
    assert base.status_code == 200, base.text
    assert base.json()["travellers"][0]["peak_rolling_days"] == 90
    payload["included_plan_ids"] = [plan["id"]]
    selected = client.post("/api/v1/eligibility/evaluate", headers=headers, json=payload)
    assert selected.json()["travellers"][0]["status"] == "OVER_LIMIT"
    payload["candidate"] = draft(a, "2026-04-01", "2026-04-05", status="PLANNED")
    payload["exclude_trip_id"] = plan["id"]
    self_result = client.post("/api/v1/eligibility/evaluate", headers=headers, json=payload)
    assert self_result.json()["travellers"][0]["peak_rolling_days"] == 90
    assert self_result.json()["included_plan_ids"] == []


def test_unknown_history_and_independent_summary(environment):
    client, _, headers, profiles = household(environment)
    candidate = draft(profiles[0]["id"], status="PLANNED")
    assessed = client.post(
        "/api/v1/eligibility/evaluate", headers=headers, json={"candidate": candidate}
    ).json()["travellers"][0]
    assert assessed["status"] == "UNKNOWN"
    assert assessed["earliest_full_trip_entry"] is None
    client.post("/api/v1/trips", headers=headers, json=draft(profiles[0]["id"]))
    for profile in client.get("/api/v1/travellers").json():
        review(client, headers, profile)
    summary = client.get("/api/v1/eligibility/summary?reference_date=2026-01-10").json()
    assert [person["used_days"] for person in summary["travellers"]] == [10, 0]
    assert [person["remaining_days"] for person in summary["travellers"]] == [80, 90]
    assert summary["baseline"].startswith("Confirmed history only")


def test_confirm_plan_requires_explicit_actual_history_and_retains_identity(environment):
    client, _, headers, profiles = household(environment)
    payload = draft(profiles[0]["id"], status="PLANNED")
    saved = client.post("/api/v1/trips", headers=headers, json=payload).json()
    payload.update(status="HISTORY", version=1)
    url = f"/api/v1/trips/{saved['id']}"
    assert client.patch(url, headers=headers, json=payload).status_code == 422
    confirmed = client.post(url + "/confirm", headers=headers, json=payload)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["id"] == saved["id"]
    assert confirmed.json()["status"] == "HISTORY"
    assert client.post(url + "/confirm", headers=headers, json=payload).status_code == 422


def test_cannot_hide_confirmed_history_or_unknown_plan_in_scenario(environment):
    client, _, headers, profiles = household(environment)
    saved = client.post("/api/v1/trips", headers=headers, json=draft(profiles[0]["id"])).json()
    payload = {
        "candidate": draft(profiles[0]["id"], "2026-02-01", "2026-02-05", status="PLANNED"),
        "exclude_trip_id": saved["id"],
    }
    assert (
        client.post("/api/v1/eligibility/evaluate", headers=headers, json=payload).status_code
        == 422
    )
    payload.pop("exclude_trip_id")
    payload["included_plan_ids"] = [str(uuid4())]
    assert (
        client.post("/api/v1/eligibility/evaluate", headers=headers, json=payload).status_code
        == 409
    )


def test_full_trip_search_rechecks_country_membership_after_shift(environment):
    client, _, headers, profiles = household(environment)
    traveller_id = profiles[0]["id"]
    recorded = client.post(
        "/api/v1/trips", headers=headers, json=draft(traveller_id, "2022-10-01", "2022-12-28")
    )
    assert recorded.status_code == 201
    assert recorded.json()["participants"][0]["schengen_days"] == 89
    review(client, headers, client.get("/api/v1/travellers").json()[0])
    candidate = draft(traveller_id, "2022-12-30", "2023-01-02", code="HR", status="PLANNED")
    response = client.post(
        "/api/v1/eligibility/evaluate", headers=headers, json={"candidate": candidate}
    )
    assert response.status_code == 200, response.text
    assessment = response.json()["travellers"][0]
    assert assessment["first_breach_date"] == "2023-01-02"
    assert assessment["earliest_full_trip_entry"] == "2023-03-29"
