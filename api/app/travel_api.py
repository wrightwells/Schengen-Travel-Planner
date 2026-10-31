from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from functools import partial
from types import SimpleNamespace
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from app.catalogue import CATALOGUE_VERSION, COVERAGE_START, MAX_DATE, RULE_START
from app.models import Session, Traveller, Trip
from app.services.calendar import calendar_view
from app.services.eligibility import evaluate
from app.services.exports import ExportType, export_document
from app.services.imports import ImportCommit, ImportInput, commit_import, preview_import
from app.services.travel import (
    Catalogue,
    apply_trip,
    audit,
    conflicting_segments,
    fail,
    invalidate_review,
    load_trips,
    summary,
    trip_view,
    validate_trip,
)
from app.travel_schemas import EvaluationInput, TripInput, TripUpdate


def travel_router(database, authenticated):
    router = APIRouter(prefix="/api/v1", dependencies=[Depends(authenticated)])

    def lock_profiles(db):
        db.scalars(select(Traveller).order_by(Traveller.id).with_for_update()).all()

    def get_trip(db, trip_id, *, lock=False):
        query = select(Trip).where(Trip.id == trip_id)
        if lock:
            query = query.with_for_update()
        trip = db.scalar(query)
        if trip is None:
            fail("TRIP_NOT_FOUND", "Trip not found", 404)
        return trip

    @router.post("/imports/history/preview")
    def preview_history_import(
        payload: ImportInput,
        session: Session = Depends(authenticated),
        db: DBSession = Depends(database),
    ):
        return preview_import(db, payload, session.csrf_token)

    @router.post("/imports/history/commit")
    def commit_history_import(
        payload: ImportCommit,
        session: Session = Depends(authenticated),
        db: DBSession = Depends(database),
    ):
        return commit_import(db, payload, session)

    @router.get("/exports/{export_type}")
    def export_travel(
        export_type: ExportType,
        traveller_id: UUID | None = None,
        export_date: date | None = None,
        preview: bool = False,
        db: DBSession = Depends(database),
    ):
        document = export_document(
            db, export_type, traveller_id, export_date or datetime.now(UTC).date()
        )
        if preview:
            return document.preview()
        return Response(
            content=document.content,
            media_type=document.media_type,
            headers={"Content-Disposition": f'attachment; filename="{document.filename}"'},
        )

    @router.get("/countries")
    def countries(
        query: str = Query(default="", max_length=100), db: DBSession = Depends(database)
    ):
        catalogue = Catalogue(db)
        items = []
        for country in sorted(catalogue.countries.values(), key=lambda item: item.name):
            if query.casefold() not in country.name.casefold() and query.upper() != country.code:
                continue
            items.append(
                {
                    "code": country.code,
                    "name": country.name,
                    "note": country.note,
                    "memberships": [
                        {
                            "effective_from": i.effective_from,
                            "effective_to": i.effective_to,
                            "is_schengen": i.is_schengen,
                        }
                        for i in catalogue.memberships.get(country.code, [])
                    ],
                }
            )
        return {"countries": items, "version": CATALOGUE_VERSION, "coverage_start": COVERAGE_START}

    @router.get("/trips")
    def trips(
        status: str | None = Query(default=None, pattern="^(HISTORY|PLANNED)$"),
        traveller_id: UUID | None = None,
        country: str | None = None,
        start: date | None = None,
        end: date | None = None,
        db: DBSession = Depends(database),
    ):
        if start and end and start > end:
            fail("INVALID_DATE_RANGE", "Filter start date must precede end date")
        catalogue = Catalogue(db)
        result = []
        for trip in load_trips(db, status=status):
            matching = [
                p
                for p in trip.participants
                if (
                    (traveller_id is None or p.traveller_id == traveller_id)
                    and (start is None or p.exit_date >= start)
                    and (end is None or p.entry_date <= end)
                    and (country is None or any(s.country_code == country for s in p.segments))
                )
            ]
            if matching:
                result.append(trip_view(trip, catalogue))
        result.sort(
            key=lambda trip: max(p["entry_date"] for p in trip["participants"]), reverse=True
        )
        return result

    @router.get("/trips/{trip_id}")
    def trip_detail(trip_id: UUID, db: DBSession = Depends(database)):
        return trip_view(get_trip(db, trip_id), Catalogue(db))

    @router.post("/trips", status_code=201)
    def create_trip(
        payload: TripInput,
        session: Session = Depends(authenticated),
        db: DBSession = Depends(database),
    ):
        catalogue = Catalogue(db)
        validate_trip(db, payload, catalogue)
        trip = Trip()
        apply_trip(trip, payload)
        db.add(trip)
        db.flush()
        after = trip_view(trip, catalogue)
        audit(db, session.user_id, trip.id, "CREATE", None, after)
        if trip.status == "HISTORY":
            invalidate_review(db, [p.traveller_id for p in trip.participants])
        db.commit()
        return after

    def replace_trip(db, session, trip, payload, catalogue, operation):
        if trip.version != payload.version:
            fail("EDIT_CONFLICT", "Trip changed in another window; reload before saving", 409)
        validate_trip(db, payload, catalogue, exclude_id=trip.id)
        before = trip_view(trip, catalogue)
        ids = {p.traveller_id for p in trip.participants} | {
            p.traveller_id for p in payload.participants
        }
        # Keep IDs for unchanged segments, including when confirming a plan.
        segment_ids = {
            (p.traveller_id, s.country_code, s.start_date, s.end_date): s.id
            for p in trip.participants
            for s in p.segments
        }
        previous_status = trip.status
        trip.participants.clear()
        db.flush()
        apply_trip(trip, payload)
        for participant in trip.participants:
            for segment in participant.segments:
                key = (
                    participant.traveller_id,
                    segment.country_code,
                    segment.start_date,
                    segment.end_date,
                )
                if key in segment_ids:
                    segment.id = segment_ids[key]
        trip.version += 1
        db.flush()
        after = trip_view(trip, catalogue)
        audit(db, session.user_id, trip.id, operation, before, after)
        if "HISTORY" in {previous_status, trip.status}:
            invalidate_review(db, ids)
        db.commit()
        return after

    @router.patch("/trips/{trip_id}")
    def update_trip(
        trip_id: UUID,
        payload: TripUpdate,
        session: Session = Depends(authenticated),
        db: DBSession = Depends(database),
    ):
        lock_profiles(db)
        trip = get_trip(db, trip_id, lock=True)
        if trip.status != payload.status:
            fail("CONFIRM_REQUIRED", "Use Confirm as history to record actual travel")
        return replace_trip(db, session, trip, payload, Catalogue(db), "UPDATE")

    @router.post("/trips/{trip_id}/confirm")
    def confirm_trip(
        trip_id: UUID,
        payload: TripUpdate,
        session: Session = Depends(authenticated),
        db: DBSession = Depends(database),
    ):
        lock_profiles(db)
        trip = get_trip(db, trip_id, lock=True)
        if trip.status != "PLANNED" or payload.status != "HISTORY":
            fail("INVALID_CONFIRMATION", "Only a saved plan can be confirmed as actual history")
        return replace_trip(db, session, trip, payload, Catalogue(db), "CONFIRM")

    @router.delete("/trips/{trip_id}", status_code=204)
    def delete_trip(
        trip_id: UUID,
        version: int = Query(ge=1),
        session: Session = Depends(authenticated),
        db: DBSession = Depends(database),
    ):
        lock_profiles(db)
        trip = get_trip(db, trip_id, lock=True)
        if trip.version != version:
            fail("EDIT_CONFLICT", "Trip changed in another window; reload before deleting", 409)
        before = trip_view(trip, Catalogue(db))
        if trip.status == "HISTORY":
            invalidate_review(db, [p.traveller_id for p in trip.participants])
        audit(db, session.user_id, trip.id, "DELETE", before, {"deleted": True})
        db.delete(trip)
        db.commit()
        return Response(status_code=204)

    @router.get("/calendar")
    def calendar(
        start: date = Query(ge=COVERAGE_START, le=MAX_DATE),
        end: date = Query(ge=COVERAGE_START, le=MAX_DATE),
        reference_date: date = Query(ge=RULE_START, le=date(2099, 12, 31)),
        included_plan_ids: list[UUID] = Query(default=[], max_length=100),
        db: DBSession = Depends(database),
    ):
        return calendar_view(db, Catalogue(db), start, end, reference_date, set(included_plan_ids))

    @router.get("/eligibility/summary")
    def allowance(
        reference_date: date = Query(ge=RULE_START, le=date(2099, 12, 31)),
        db: DBSession = Depends(database),
    ):
        return summary(db, reference_date, Catalogue(db))

    @router.post("/eligibility/evaluate")
    def evaluate_itinerary(payload: EvaluationInput, db: DBSession = Depends(database)):
        catalogue = Catalogue(db)
        # Validate shape/coverage and participants. Exclusion must reference an existing trip.
        if payload.exclude_trip_id:
            if get_trip(db, payload.exclude_trip_id).status != "PLANNED":
                fail("INVALID_EXCLUSION", "Only the saved plan being edited can be excluded")
        validate_trip(db, payload.candidate, catalogue, exclude_id=payload.exclude_trip_id)
        trips = load_trips(db)
        selected_ids = set(payload.included_plan_ids)
        plans = {trip.id: trip for trip in trips if trip.status == "PLANNED"}
        if not selected_ids <= plans.keys():
            fail("UNKNOWN_PLAN", "One of the selected baseline plans no longer exists", 409)
        baseline_trips = [
            trip
            for trip in trips
            if trip.id != payload.exclude_trip_id
            and (trip.status == "HISTORY" or trip.id in selected_ids)
        ]
        result = []
        for candidate in payload.candidate.participants:
            if (
                candidate.entry_date < RULE_START
                or candidate.exit_date + timedelta(days=payload.search_days) > MAX_DATE
            ):
                fail(
                    "UNSUPPORTED_DATE",
                    "Assessments support entry from 2013-10-18 and horizons ending before 2101",
                )
            profile = db.get(Traveller, candidate.traveller_id)
            baseline = set()
            baseline_segments = []
            for trip in baseline_trips:
                for participant in trip.participants:
                    if participant.traveller_id == candidate.traveller_id:
                        if conflicting_segments(candidate.segments, participant.segments):
                            fail(
                                "OVERLAPPING_LOCATION",
                                f"Itinerary conflicts with baseline trip: {trip.title}",
                                409,
                            )
                        if conflicting_segments(participant.segments, baseline_segments):
                            fail(
                                "OVERLAPPING_LOCATION",
                                "Selected baseline plans conflict; exclude an alternative",
                                409,
                            )
                        baseline_segments.extend(participant.segments)
                        baseline.update(
                            catalogue.presence(
                                participant.segments,
                                start=candidate.entry_date - timedelta(days=179),
                                end=max(
                                    candidate.exit_date,
                                    candidate.entry_date + timedelta(days=payload.search_days - 1),
                                ),
                            )
                        )
            assessment = evaluate(
                baseline,
                catalogue.presence(candidate.segments),
                entry=candidate.entry_date,
                exit=candidate.exit_date,
                rule_applicable=profile.rule_applicable,
                history_complete=profile.history_complete,
                search_days=payload.search_days,
                candidate_at=partial(
                    shifted_presence,
                    candidate,
                    catalogue=catalogue,
                    baseline_segments=baseline_segments,
                ),
                one_day_available=partial(entry_available, segments=baseline_segments),
            )
            result.append(
                {
                    "traveller_id": str(candidate.traveller_id),
                    "display_name": profile.display_name,
                    **asdict(assessment),
                }
            )
        return {
            "travellers": result,
            "catalogue_version": CATALOGUE_VERSION,
            "included_plan_ids": [
                str(plan_id) for plan_id in selected_ids if plan_id != payload.exclude_trip_id
            ],
            "baseline": "Confirmed history plus explicitly selected saved plans",
        }

    return router


def shifted_presence(candidate, start, catalogue, baseline_segments):
    """Re-resolve membership at shifted dates, and don't suggest conflicting travel."""
    delta = start - candidate.entry_date
    segments = [
        SimpleNamespace(
            country_code=s.country_code,
            start_date=s.start_date + delta,
            end_date=s.end_date + delta,
        )
        for s in candidate.segments
    ]
    if conflicting_segments(segments, baseline_segments):
        return None
    return catalogue.presence(segments)


def entry_available(day, segments):
    return not any(segment.start_date <= day <= segment.end_date for segment in segments)
