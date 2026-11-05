from uuid import uuid4

from conftest import sign_in
from test_travel import draft, review


def calendar(client, start="2027-01-01", end="2027-01-03", plans=()):
    return client.get(
        "/api/v1/calendar",
        params=[("start", start), ("end", end), ("reference_date", "2027-01-01")]
        + [("included_plan_ids", p) for p in plans],
    )


def test_calendar_private_bounded_and_unknown(environment):
    client, _ = environment
    assert calendar(client).status_code == 401
    sign_in(client)
    assert calendar(client, end="2028-01-02").status_code == 422
    assert calendar(client, end="2026-12-31").status_code == 422
    assert calendar(client, start="2013-04-21", end="2013-04-22").status_code == 422
    assert calendar(client, plans=[str(uuid4())]).status_code == 409
    day = calendar(client).json()["travellers"][0]["days"][0]
    assert day["status"] == "UNKNOWN"
    assert day["maximum_contiguous_stay_days"] is None


def test_calendar_personal_usage_breach_plan_inclusion_and_capacity(environment):
    client, _ = environment
    headers = sign_in(client)
    a, b = client.get("/api/v1/travellers").json()
    history = draft(a["id"], "2026-10-03", "2026-12-31")  # 90 inclusive days
    assert client.post("/api/v1/trips", headers=headers, json=history).status_code == 201
    plan = draft(a["id"], "2027-01-01", "2027-01-02", status="PLANNED")
    saved = client.post("/api/v1/trips", headers=headers, json=plan).json()
    for profile in client.get("/api/v1/travellers").json():
        review(client, headers, profile)
    people = calendar(client).json()["travellers"]
    assert people[0]["days"][0]["status"] == "UNAVAILABLE"
    assert people[0]["days"][0]["maximum_contiguous_stay_days"] == 0
    assert people[1]["days"][0]["status"] == "AVAILABLE"
    assert people[1]["days"][0]["maximum_contiguous_stay_days"] == 90
    included = calendar(client, plans=[saved["id"]]).json()["travellers"][0]["days"]
    assert included[0]["status"] == "OVER_LIMIT"
    assert included[0]["used_days"] == 91
    assert included[1]["used_days"] == 92
    assert included[0]["planned_presence"] is True
    assert included[0]["history_presence"] is False
    assert included[0]["trips"][0]["title"] == plan["title"]
    assert calendar(client).json()["travellers"][0]["days"][0]["used_days"] == 90


def test_calendar_membership_boundary_neutral_history_and_conflicts(environment):
    client, _ = environment
    headers = sign_in(client)
    a, b = client.get("/api/v1/travellers").json()
    history = draft(a["id"], "2024-03-30", "2024-04-01", code="RO")
    history["participants"] += draft(b["id"], "2024-03-30", "2024-04-01", code="GB")["participants"]
    assert client.post("/api/v1/trips", headers=headers, json=history).status_code == 201
    result = calendar(client, "2024-03-30", "2024-04-01").json()["travellers"]
    assert [d["used_days"] for d in result[0]["days"]] == [0, 1, 2]
    assert [d["history_presence"] for d in result[0]["days"]] == [False, True, True]
    assert all(not d["history_presence"] and d["trips"] for d in result[1]["days"])
    plan = draft(a["id"], "2024-03-30", "2024-04-01", status="PLANNED")
    saved = client.post("/api/v1/trips", headers=headers, json=plan).json()
    assert calendar(client, "2024-03-30", "2024-04-01", [saved["id"]]).status_code == 409


def test_calendar_leap_day_deduplication_and_rule_not_assessed(environment):
    client, _ = environment
    headers = sign_in(client)
    profile = client.get("/api/v1/travellers").json()[0]
    trip = draft(profile["id"], "2028-02-28", "2028-03-01")
    person = trip["participants"][0]
    person["segments"][0]["end_date"] = "2028-02-29"
    person["segments"].append(
        {"country_code": "ES", "start_date": "2028-02-29", "end_date": "2028-03-01"}
    )
    assert client.post("/api/v1/trips", headers=headers, json=trip).status_code == 201
    profile = client.get("/api/v1/travellers").json()[0]
    profile = review(client, headers, profile)
    result = calendar(client, "2028-02-28", "2028-03-01").json()["travellers"][0]["days"]
    assert [d["used_days"] for d in result] == [1, 2, 3]
    assert result[1]["trips"][0]["countries"] == ["France", "Spain"]
    payload = {k: profile[k] for k in ("display_name", "history_complete", "notes", "version")}
    payload["rule_applicable"] = False
    assert (
        client.patch(
            f"/api/v1/travellers/{profile['id']}", headers=headers, json=payload
        ).status_code
        == 200
    )
    day = calendar(client).json()["travellers"][0]["days"][0]
    assert day["status"] == "NOT_ASSESSED"
    assert day["maximum_contiguous_stay_days"] is None


def test_scenario_selection_controls_plan_visibility_and_usage(environment):
    client, _ = environment
    headers = sign_in(client)
    a, b = client.get("/api/v1/travellers").json()
    saved = []
    for code in ("FR", "ES"):
        payload = draft(a["id"], "2027-01-01", "2027-01-02", code=code, status="PLANNED")
        payload["title"] = f"Alternative {code}"
        payload["participants"] += draft(b["id"], "2027-01-01", "2027-01-02", code="GB")[
            "participants"
        ]
        result = client.post("/api/v1/trips", headers=headers, json=payload)
        assert result.status_code == 201
        saved.append(result.json())
    for person in client.get("/api/v1/travellers").json():
        review(client, headers, person)
    params = {
        "start": "2027-01-01",
        "end": "2027-01-03",
        "reference_date": "2027-01-01",
    }
    result = client.get("/api/v1/calendar", params=params)
    assert result.status_code == 200, result.text
    a_day, b_day = [p["days"][0] for p in result.json()["travellers"]]
    assert a_day["used_days"] == 0 and a_day["status"] == "AVAILABLE"
    assert not a_day["planned_presence"] and a_day["trips"] == []
    assert b_day["trips"] == []
    result = client.get("/api/v1/calendar", params={**params, "included_plan_ids": saved[0]["id"]})
    assert result.status_code == 200
    day = result.json()["travellers"][0]["days"][0]
    assert day["used_days"] == 1
    assert day["planned_presence"]
    assert len(day["trips"]) == 1 and day["trips"][0]["id"] == saved[0]["id"]
    assert calendar(client, plans=[t["id"] for t in saved]).status_code == 409


def test_calendar_can_display_earliest_history_and_latest_saved_dates(environment):
    client, _ = environment
    headers = sign_in(client)
    a = client.get("/api/v1/travellers").json()[0]
    for start, end, status in (
        ("2013-04-22", "2013-04-23", "HISTORY"),
        ("2100-12-30", "2100-12-31", "PLANNED"),
    ):
        saved = client.post(
            "/api/v1/trips", headers=headers, json=draft(a["id"], start, end, status=status)
        )
        assert saved.status_code == 201
        result = client.get(
            "/api/v1/calendar",
            params={
                "start": start,
                "end": end,
                "reference_date": "2027-01-01",
                "included_plan_ids": [saved.json()["id"]] if status == "PLANNED" else [],
            },
        )
        assert result.status_code == 200, result.text
        days = result.json()["travellers"][0]["days"]
        assert all(len(d["trips"]) == 1 and d["trips"][0]["status"] == status for d in days)
        if status == "HISTORY":
            assert all(d["status"] == "UNKNOWN" for d in days)


def test_calendar_2027_counts_only_drop_when_recorded_days_leave_window(environment):
    client, _ = environment
    headers = sign_in(client)
    profile = client.get("/api/v1/travellers").json()[0]
    plans = []
    for start, end in (
        ("2027-03-05", "2027-04-18"),
        ("2027-07-08", "2027-08-15"),
        ("2027-10-14", "2027-11-07"),
    ):
        saved = client.post(
            "/api/v1/trips",
            headers=headers,
            json=draft(profile["id"], start, end, status="PLANNED"),
        )
        assert saved.status_code == 201
        plans.append(saved.json()["id"])
    result = calendar(client, "2027-03-01", "2028-01-05", plans)
    assert result.status_code == 200
    days = {d["date"]: d for d in result.json()["travellers"][0]["days"]}
    for day, used in {
        "2027-07-16": 54,
        "2027-07-31": 69,
        "2027-08-15": 84,
        "2027-08-16": 84,
        "2027-08-31": 84,
        "2027-09-01": 83,
        "2027-11-07": 64,
        "2027-11-08": 64,
        "2028-01-03": 64,
        "2028-01-04": 63,
        "2028-01-05": 62,
    }.items():
        assert days[day]["used_days"] == used
        assert days[day]["remaining_days"] == 90 - used
    # Fetching a month must produce the same counts as a longer view.
    july = calendar(client, "2027-07-01", "2027-07-31", plans)
    assert july.status_code == 200
    for day in july.json()["travellers"][0]["days"]:
        assert day == days[day["date"]]


def test_extra_capacity_preserves_later_plans_and_rich_november_rolloff(environment):
    client, _ = environment
    headers = sign_in(client)
    a, b = client.get("/api/v1/travellers").json()
    plans = []
    for start, end, shared in (
        ("2026-11-08", "2026-11-16", False),
        ("2027-02-26", "2027-04-11", True),
        ("2027-06-11", "2027-07-25", True),
    ):
        payload = draft(a["id"], start, end, status="PLANNED")
        if shared:
            payload["participants"] += draft(b["id"], start, end)["participants"]
        saved = client.post("/api/v1/trips", headers=headers, json=payload)
        assert saved.status_code == 201
        plans.append(saved.json()["id"])
    for profile in client.get("/api/v1/travellers").json():
        review(client, headers, profile)
    year = calendar(client, "2027-01-01", "2027-12-31", plans).json()["travellers"]
    for person, remaining in zip(year, (36, 45), strict=True):
        days = {d["date"]: d for d in person["days"]}
        assert days["2027-04-12"]["remaining_days"] == remaining
        assert days["2027-05-15"]["remaining_days"] == 45
        assert days["2027-07-25"]["used_days"] == 90
        for key in ("2027-04-12", "2027-05-15", "2027-06-10"):
            assert days[key]["maximum_additional_stay_days"] == 0
            assert days[key]["status"] == "UNAVAILABLE"
        assert days["2027-04-12"]["maximum_contiguous_stay_days"] == 45
    april = calendar(client, "2027-04-01", "2027-04-30", plans).json()["travellers"]
    for monthly, yearly in zip(april, year, strict=True):
        assert monthly["days"] == [d for d in yearly["days"] if d["date"].startswith("2027-04")]
    # Removing summer releases capacity; it must stop at the next booking otherwise.
    no_summer = calendar(client, "2027-05-15", "2027-05-15", plans[:2]).json()["travellers"]
    assert all(p["days"][0]["maximum_additional_stay_days"] == 45 for p in no_summer)
    evaluated = client.post(
        "/api/v1/eligibility/evaluate",
        headers=headers,
        json={
            "candidate": draft(a["id"], "2027-05-15", "2027-05-15", status="PLANNED"),
            "included_plan_ids": plans,
            "search_days": 1,
        },
    )
    assert evaluated.status_code == 200
    assessment = evaluated.json()["travellers"][0]
    assert assessment["status"] == "OVER_LIMIT"
    assert assessment["first_breach_date"] == "2027-07-25"


def test_extra_capacity_checks_far_future_days_and_stops_at_neutral_booking(environment):
    client, _ = environment
    headers = sign_in(client)
    a = client.get("/api/v1/travellers").json()[0]
    saved = client.post(
        "/api/v1/trips",
        headers=headers,
        json=draft(a["id"], "2027-04-01", "2027-06-29", status="PLANNED"),
    ).json()
    review(client, headers, a)
    # The breach would be in June, well beyond the old visible-end + 90-day horizon.
    day = calendar(client, "2027-01-01", "2027-01-01", [saved["id"]]).json()["travellers"][0][
        "days"
    ][0]
    assert day["maximum_additional_stay_days"] == 0
    assert day["remaining_days"] == 90
    assert day["status"] == "UNAVAILABLE"
    neutral = client.post(
        "/api/v1/trips",
        headers=headers,
        json=draft(a["id"], "2027-01-04", "2027-01-06", code="GB", status="PLANNED"),
    ).json()
    day = calendar(client, plans=[neutral["id"]]).json()["travellers"][0]["days"][0]
    assert day["maximum_additional_stay_days"] == 3
