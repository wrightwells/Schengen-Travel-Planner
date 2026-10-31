"""Bounded, date-only calendar projections for an explicit saved-plan baseline."""

from datetime import timedelta

from sqlalchemy import select

from app.catalogue import CATALOGUE_VERSION, RULE_START
from app.models import Traveller
from app.services.eligibility import PresenceIndex, dates_between
from app.services.travel import conflicting_segments, fail, load_trips


def calendar_view(db, catalogue, start, end, reference_date, selected_ids):
    if start > end or (end - start).days > 365:
        fail("INVALID_DATE_RANGE", "Choose an inclusive range of at most 366 days")
    trips = load_trips(db)
    plans = {trip.id for trip in trips if trip.status == "PLANNED"}
    if not selected_ids <= plans:
        fail("UNKNOWN_PLAN", "One of the selected baseline plans no longer exists", 409)
    baseline = [t for t in trips if t.status == "HISTORY" or t.id in selected_ids]
    people = []
    for profile in db.scalars(select(Traveller).order_by(Traveller.slot)):
        presence = set()
        bookings = []
        segments = []
        for trip in baseline:
            for participant in trip.participants:
                if participant.traveller_id != profile.id:
                    continue
                if conflicting_segments(participant.segments, segments):
                    fail(
                        "OVERLAPPING_LOCATION",
                        "Selected baseline plans conflict; exclude an alternative",
                        409,
                    )
                segments.extend(participant.segments)
                schengen = catalogue.presence(
                    participant.segments,
                    start=start - timedelta(days=179),
                    end=end + timedelta(days=90),
                )
                presence.update(schengen)
                bookings.append((trip, participant, schengen))
        index = PresenceIndex(presence)
        days = []
        for day in sorted(dates_between(start, end)):
            associated = [(t, p, s) for t, p, s in bookings if p.entry_date <= day <= p.exit_date]
            used = index.used(day)
            assessed = profile.rule_applicable is True and profile.history_complete
            if profile.rule_applicable is False:
                status = "NOT_ASSESSED"
            elif not assessed or day < RULE_START:
                status = "UNKNOWN"
            elif used > 90 and day in presence:
                status = "OVER_LIMIT"
            elif not associated and day >= reference_date:
                status = "AVAILABLE" if used < 90 else "UNAVAILABLE"
            else:
                status = "APPROACHING_LIMIT" if used >= 80 else "ASSESSED"
            maximum = None
            if assessed and day >= max(reference_date, RULE_START) and not associated:
                maximum = 0
                new_days = 0
                for offset in range(91):
                    probe = day + timedelta(days=offset)
                    new_days += probe not in presence
                    if index.used(probe) + new_days > 90:
                        break
                    maximum += 1
            days.append(
                {
                    "date": day,
                    "used_days": used,
                    "remaining_days": max(0, 90 - used),
                    "status": status,
                    "maximum_contiguous_stay_days": maximum,
                    "history_presence": any(
                        t.status == "HISTORY" and day in s for t, _, s in associated
                    ),
                    "planned_presence": any(
                        t.status == "PLANNED" and day in s for t, _, s in associated
                    ),
                    "trips": [
                        {
                            "id": str(t.id),
                            "title": t.title,
                            "status": t.status,
                            "countries": [
                                catalogue.countries[s.country_code].name
                                for s in p.segments
                                if s.start_date <= day <= s.end_date
                            ],
                        }
                        for t, p, _ in associated
                    ],
                }
            )
        people.append(
            {"traveller_id": str(profile.id), "display_name": profile.display_name, "days": days}
        )
    return {
        "start": start,
        "end": end,
        "reference_date": reference_date,
        "baseline": "Confirmed history plus explicitly selected saved plans",
        "included_plan_ids": sorted(str(i) for i in selected_ids),
        "catalogue_version": CATALOGUE_VERSION,
        "travellers": people,
    }
