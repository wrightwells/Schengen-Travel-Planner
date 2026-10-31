from datetime import date, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.catalogue import CATALOGUE_VERSION, COVERAGE_START
from app.models import (
    AuditEvent,
    Country,
    Membership,
    Traveller,
    Trip,
    TripParticipant,
    TripSegment,
)
from app.services.eligibility import PresenceIndex, dates_between
from app.travel_schemas import ParticipantInput, TripInput


def fail(code: str, message: str, status=422):
    raise HTTPException(status, detail={"code": code, "message": message})


class Catalogue:
    def __init__(self, db: Session):
        self.countries = {country.code: country for country in db.scalars(select(Country))}
        self.memberships: dict[str, list[Membership]] = {}
        for interval in db.scalars(select(Membership).order_by(Membership.effective_from)):
            self.memberships.setdefault(interval.country_code, []).append(interval)

    def presence(self, segments, *, start: date | None = None, end: date | None = None):
        days = set()
        for segment in segments:
            if segment.country_code not in self.countries:
                fail("UNKNOWN_COUNTRY", "Choose a destination from the country catalogue")
            lower = max(segment.start_date, start or segment.start_date)
            upper = min(segment.end_date, end or segment.end_date)
            if lower > upper:
                continue
            covered = 0
            for interval in self.memberships.get(segment.country_code, []):
                a = max(lower, interval.effective_from)
                b = min(upper, interval.effective_to or upper)
                if a <= b:
                    covered += (b - a).days + 1
                    if interval.is_schengen:
                        days.update(dates_between(a, b))
            if covered != (upper - lower).days + 1:
                fail("UNKNOWN_MEMBERSHIP", "Country membership is unknown for these dates")
        return frozenset(days)


def load_trips(db: Session, *, status: str | None = None):
    query = select(Trip).options(
        selectinload(Trip.participants).selectinload(TripParticipant.segments)
    )
    if status:
        query = query.where(Trip.status == status)
    return list(db.scalars(query).all())


def boundary_transition(a, b) -> bool:
    return a.country_code != b.country_code and (
        a.end_date == b.start_date or b.end_date == a.start_date
    )


def validate_participant(participant: ParticipantInput, catalogue: Catalogue):
    segments = sorted(
        participant.segments, key=lambda segment: (segment.start_date, segment.end_date)
    )
    covered_until = participant.entry_date - timedelta(days=1)
    for index, segment in enumerate(segments):
        if segment.start_date < participant.entry_date or segment.end_date > participant.exit_date:
            fail(
                "INVALID_DATE_RANGE", "Country segment dates must lie within this traveller's dates"
            )
        if segment.start_date > covered_until + timedelta(days=1):
            fail(
                "INCOMPLETE_ITINERARY", "Every itinerary day needs a destination, including UK days"
            )
        covered_until = max(covered_until, segment.end_date)
        for previous in segments[:index]:
            if max(previous.start_date, segment.start_date) <= min(
                previous.end_date, segment.end_date
            ):
                if not boundary_transition(previous, segment):
                    fail(
                        "OVERLAPPING_LOCATION",
                        "Segments overlap; only same-day border transitions are allowed",
                    )
    if covered_until != participant.exit_date:
        fail("INCOMPLETE_ITINERARY", "Country segments must cover the traveller's whole itinerary")
    catalogue.presence(segments)


def conflicting_segments(candidate, existing):
    for a in candidate:
        for b in existing:
            if max(a.start_date, b.start_date) <= min(a.end_date, b.end_date):
                if not boundary_transition(a, b):
                    return True
    return False


def validate_trip(
    db: Session, payload: TripInput, catalogue: Catalogue, *, exclude_id: UUID | None = None
):
    ids = [participant.traveller_id for participant in payload.participants]
    if len(set(ids)) != len(ids):
        fail("DUPLICATE_PARTICIPANT", "Choose each traveller once per trip")
    # All writes lock profiles in the same order, preventing concurrent overlap inserts.
    profiles = db.scalars(select(Traveller).order_by(Traveller.id).with_for_update()).all()
    if not set(ids) <= {profile.id for profile in profiles}:
        fail("UNKNOWN_TRAVELLER", "Choose an existing household traveller")
    for participant in payload.participants:
        validate_participant(participant, catalogue)
    if payload.status == "HISTORY":
        for trip in load_trips(db, status="HISTORY"):
            if trip.id == exclude_id:
                continue
            for existing in trip.participants:
                for candidate in payload.participants:
                    if existing.traveller_id == candidate.traveller_id and conflicting_segments(
                        candidate.segments, existing.segments
                    ):
                        fail(
                            "OVERLAPPING_LOCATION",
                            f"Dates conflict with recorded trip: {trip.title}",
                            409,
                        )


def trip_view(trip: Trip, catalogue: Catalogue):
    return {
        "id": str(trip.id),
        "title": trip.title,
        "status": trip.status,
        "version": trip.version,
        "created_at": trip.created_at.isoformat(),
        "updated_at": trip.updated_at.isoformat(),
        "participants": [
            {
                "traveller_id": str(p.traveller_id),
                "entry_date": p.entry_date.isoformat(),
                "exit_date": p.exit_date.isoformat(),
                "schengen_days": len(catalogue.presence(p.segments)),
                "segments": [
                    {
                        "id": str(s.id),
                        "country_code": s.country_code,
                        "country_name": catalogue.countries[s.country_code].name,
                        "start_date": s.start_date.isoformat(),
                        "end_date": s.end_date.isoformat(),
                    }
                    for s in p.segments
                ],
            }
            for p in trip.participants
        ],
        "catalogue_version": CATALOGUE_VERSION,
    }


def apply_trip(trip: Trip, payload: TripInput):
    trip.title = payload.title
    trip.status = payload.status
    for participant in payload.participants:
        trip.participants.append(
            TripParticipant(
                traveller_id=participant.traveller_id,
                entry_date=participant.entry_date,
                exit_date=participant.exit_date,
                segments=[TripSegment(**s.model_dump()) for s in participant.segments],
            )
        )


def audit(db: Session, actor: UUID, trip_id: UUID, operation: str, before, after):
    db.add(
        AuditEvent(
            actor_id=actor,
            entity="trip",
            entity_id=trip_id,
            operation=operation,
            before_json=before,
            after_json=after,
        )
    )


def invalidate_review(db: Session, traveller_ids):
    for profile in db.scalars(select(Traveller).where(Traveller.id.in_(traveller_ids))):
        profile.history_complete = False
        profile.history_reviewed_on = None
        profile.version += 1


def summary(db: Session, reference_date: date, catalogue: Catalogue):
    history = load_trips(db, status="HISTORY")
    result = []
    for profile in db.scalars(select(Traveller).order_by(Traveller.slot)):
        presence = set()
        for trip in history:
            for participant in trip.participants:
                if participant.traveller_id == profile.id:
                    presence.update(
                        catalogue.presence(
                            participant.segments,
                            start=reference_date - timedelta(days=179),
                            end=reference_date,
                        )
                    )
        used = PresenceIndex(presence).used(reference_date)
        status = "UNKNOWN"
        if profile.rule_applicable is False:
            status = "NOT_ASSESSED"
        elif profile.rule_applicable is True and profile.history_complete:
            status = (
                "OVER_LIMIT" if used > 90 else "APPROACHING_LIMIT" if used >= 80 else "ASSESSED"
            )
        result.append(
            {
                "traveller_id": str(profile.id),
                "display_name": profile.display_name,
                "used_days": used,
                "remaining_days": max(0, 90 - used),
                "status": status,
                "history_complete": profile.history_complete,
                "history_reviewed_on": profile.history_reviewed_on,
            }
        )
    return {
        "reference_date": reference_date,
        "window_start": reference_date - timedelta(days=179),
        "baseline": "Confirmed history only; saved plans excluded",
        "travellers": result,
        "catalogue_version": CATALOGUE_VERSION,
        "coverage_start": COVERAGE_START,
    }
