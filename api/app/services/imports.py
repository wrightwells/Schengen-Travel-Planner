"""Bounded CSV imports with session-bound previews and atomic, revalidated commits."""

import csv
import hashlib
import hmac
import json
import re
import time
from collections import defaultdict
from io import StringIO
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field, ValidationError
from sqlalchemy import select

from app.models import Traveller, Trip
from app.services.exports import CSV_COLUMNS, spreadsheet_text
from app.services.travel import (
    Catalogue,
    apply_trip,
    audit,
    conflicting_segments,
    fail,
    invalidate_review,
    load_trips,
    trip_view,
    validate_participant,
    validate_trip,
)
from app.travel_schemas import StrictModel, TripInput

MAX_CSV_BYTES = 512_000
MAX_ROWS = 2000


class ImportInput(StrictModel):
    # Preserve whitespace in names/titles and CSV records.
    model_config = {"extra": "forbid", "str_strip_whitespace": False}
    content: str = Field(max_length=MAX_CSV_BYTES)
    traveller_mapping: dict[str, UUID] = Field(default_factory=dict, max_length=100)


class ImportCommit(ImportInput):
    preview_token: str = Field(max_length=100)
    decisions: dict[str, str] = Field(max_length=MAX_ROWS)


def literal_text(value):
    """Reverse only the spreadsheet protection emitted by our CSV exporter."""
    return value[1:] if value.startswith("'") and spreadsheet_text(value[1:]) == value else value


def read_rows(content):
    if len(content.encode("utf-8")) > MAX_CSV_BYTES:
        fail("IMPORT_TOO_LARGE", "CSV must be at most 512 KB", 413)
    try:
        reader = csv.DictReader(StringIO(content.lstrip("\ufeff"), newline=""), strict=True)
        if reader.fieldnames != list(CSV_COLUMNS):
            fail("INVALID_CSV", "Use the exact CSV schema 1 headers from a history export")
        rows = []
        for number, row in enumerate(reader, 2):
            if len(rows) >= MAX_ROWS:
                fail("IMPORT_TOO_LARGE", "Import at most 2,000 segment rows at a time", 413)
            if None in row or any(value is None for value in row.values()):
                fail("INVALID_CSV", f"CSV row {number} has the wrong number of columns")
            if any("\x00" in value for value in row.values()):
                fail("INVALID_CSV", f"CSV row {number} contains a NUL character")
            row["traveller_name"] = literal_text(row["traveller_name"])
            row["trip_title"] = literal_text(row["trip_title"])
            rows.append((number, row))
    except csv.Error:
        fail("INVALID_CSV", "Malformed CSV quoting or oversized field; use a history CSV export")
    return rows


def canonical(payload):
    """Compare itineraries independently of export row and participant ordering."""
    data = payload.model_dump(mode="json") if isinstance(payload, TripInput) else payload
    return {
        "title": data["title"],
        "status": data["status"],
        "participants": sorted(
            [
                {
                    "traveller_id": p["traveller_id"],
                    "entry_date": p["entry_date"],
                    "exit_date": p["exit_date"],
                    "segments": sorted(
                        [
                            {k: s[k] for k in ("country_code", "start_date", "end_date")}
                            for s in p["segments"]
                        ],
                        key=lambda s: (s["start_date"], s["end_date"], s["country_code"]),
                    ),
                }
                for p in data["participants"]
            ],
            key=lambda p: p["traveller_id"],
        ),
    }


def prepare_import(db, payload):
    profiles = list(db.scalars(select(Traveller).order_by(Traveller.id).with_for_update()))
    profile_ids = {p.id for p in profiles}
    if not set(payload.traveller_mapping.values()) <= profile_ids:
        fail("UNKNOWN_TRAVELLER", "Map CSV names to existing household travellers")
    catalogue = Catalogue(db)
    stored = {str(t.id): t for t in load_trips(db)}
    views = {key: trip_view(t, catalogue) for key, t in stored.items()}
    groups = defaultdict(list)
    for number, row in read_rows(payload.content):
        groups[row["trip_external_id"]].append((number, row))
    names = sorted({r["traveller_name"] for group in groups.values() for _, r in group})
    mapping = {}
    for name in names:
        matches = [p.id for p in profiles if p.display_name == name]
        mapping[name] = payload.traveller_mapping.get(name) or (
            matches[0] if len(matches) == 1 else None
        )
    entries = []
    candidates = {}
    for key, group in groups.items():
        entry = {
            "key": key,
            "title": group[0][1]["trip_title"],
            "rows": [n for n, _ in group],
            "state": "invalid",
            "message": "",
            "allowed_actions": ["skip"],
            "trip": None,
        }
        entries.append(entry)
        try:
            external_id = UUID(key)
            if str(external_id) != key:
                fail("INVALID_CSV", "trip_external_id must be a canonical UUID")
            people = defaultdict(list)
            source_names = defaultdict(set)
            for number, row in group:
                if row["schema_version"] != "1" or row["trip_status"] != "HISTORY":
                    fail("INVALID_CSV", f"Row {number}: only schema 1 HISTORY rows are supported")
                if row["trip_title"] != entry["title"]:
                    fail("INVALID_CSV", "Rows for one trip must have the same title")
                person = mapping[row["traveller_name"]]
                if person is None:
                    fail("MAPPING_REQUIRED", f"Map traveller: {row['traveller_name']}")
                source_names[person].add(row["traveller_name"])
                if len(source_names[person]) > 1:
                    fail("INVALID_MAPPING", "Two CSV names cannot map to one traveller in a trip")
                for column in ("segment_start", "segment_end"):
                    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", row[column]):
                        fail("INVALID_DATE_RANGE", f"Row {number}: use YYYY-MM-DD dates")
                people[person].append(
                    {
                        "country_code": row["country_code"],
                        "start_date": row["segment_start"],
                        "end_date": row["segment_end"],
                    }
                )
            candidate = TripInput(
                title=entry["title"],
                status="HISTORY",
                participants=[
                    {
                        "traveller_id": person,
                        "entry_date": min(s["start_date"] for s in segments),
                        "exit_date": max(s["end_date"] for s in segments),
                        "segments": segments,
                    }
                    for person, segments in people.items()
                ],
            )
            # Validate the complete shape before classifying stored-record conflicts.
            for participant in candidate.participants:
                validate_participant(participant, catalogue)
            entry["trip"] = candidate.model_dump(mode="json")
            candidates[key] = candidate
            exact = next(
                (t for t, v in views.items() if canonical(v) == canonical(candidate)), None
            )
            if exact is not None:
                entry.update(
                    state="duplicate", message="Identical history already exists; skip it."
                )
            elif key in stored:
                entry.update(
                    state="conflict", message="This trip ID already exists with different data."
                )
                existing = stored[key]
                if existing.status == "HISTORY" and {
                    p.traveller_id for p in existing.participants
                } <= {p.traveller_id for p in candidate.participants}:
                    entry["allowed_actions"].append("replace")
                    entry["existing_trip"] = views[key]
                    entry["message"] += " Replace rewrites the whole trip shown below."
                else:
                    entry["message"] += (
                        " Import cannot replace plans or remove existing travellers."
                    )
            else:
                validate_trip(db, candidate, catalogue)
                entry.update(
                    state="ready",
                    message="Ready to add as confirmed history.",
                    allowed_actions=["skip", "import"],
                )
        except (ValueError, ValidationError) as error:
            entry["message"] = f"Invalid trip data: {str(error)[:500]}"
        except HTTPException as error:
            entry["state"] = "conflict" if error.status_code == 409 else "invalid"
            entry["message"] = error.detail["message"]
    # Incoming conflicts cannot be silently resolved by row order.
    for index, entry in enumerate(entries):
        if entry["state"] != "ready":
            continue
        a = candidates[entry["key"]]
        for other in entries[index + 1 :]:
            if other["key"] not in candidates:
                continue
            b = candidates[other["key"]]
            if any(
                p.traveller_id == q.traveller_id and conflicting_segments(p.segments, q.segments)
                for p in a.participants
                for q in b.participants
            ):
                warning = (
                    " Overlaps CSV trip alternatives; select at most one overlapping itinerary."
                )
                for item in (entry, other):
                    if warning not in item["message"]:
                        item["message"] += warning
    state = {
        "profiles": [(str(p.id), p.version) for p in profiles],
        "trips": sorted((key, view) for key, view in views.items()),
    }
    report = {
        "row_count": sum(len(g) for g in groups.values()),
        "entries": entries,
        "traveller_names": names,
        "mapping": {n: str(v) if v else None for n, v in mapping.items()},
    }
    return report, state, candidates, stored, catalogue


def signature(payload, report, state, issued, secret):
    data = {
        "input": payload.model_dump(mode="json", include={"content", "traveller_mapping"}),
        "report": report,
        "state": state,
        "issued": issued,
    }
    encoded = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    return hmac.new(secret.encode(), encoded, hashlib.sha256).hexdigest()


def preview_import(db, payload, secret):
    report, state, *_ = prepare_import(db, payload)
    issued = str(int(time.time()))
    report["preview_token"] = issued + "." + signature(payload, report, state, issued, secret)
    return report


def commit_import(db, payload, session):
    report, state, candidates, stored, catalogue = prepare_import(db, payload)
    issued, _, supplied = payload.preview_token.partition(".")
    if (
        not issued.isdigit()
        or not 0 <= time.time() - int(issued) <= 900
        or not hmac.compare_digest(
            supplied, signature(payload, report, state, issued, session.csrf_token)
        )
    ):
        fail(
            "IMPORT_STALE",
            "Preview expired or data changed. Preview the CSV again before importing.",
            409,
        )
    if set(payload.decisions) != {entry["key"] for entry in report["entries"]}:
        fail("IMPORT_DECISIONS", "Choose an action for every previewed trip")
    selected = []
    for entry in report["entries"]:
        action = payload.decisions[entry["key"]]
        if action not in entry["allowed_actions"]:
            fail("IMPORT_DECISIONS", "Choose one of the actions shown in the preview")
        if action != "skip":
            selected.append((entry["key"], action))
    before = {}
    segment_ids = {}
    # Remove all explicitly replaced records first, then validate the entire final batch.
    for key, action in selected:
        if action == "replace":
            before[key] = trip_view(stored[key], catalogue)
            segment_ids[key] = {
                (p.traveller_id, s.country_code, s.start_date, s.end_date): s.id
                for p in stored[key].participants
                for s in p.segments
            }
            stored[key].participants.clear()
    db.flush()
    affected = set()
    for key, action in selected:
        candidate = candidates[key]
        validate_trip(
            db, candidate, catalogue, exclude_id=UUID(key) if action == "replace" else None
        )
        trip = stored[key] if action == "replace" else Trip(id=UUID(key))
        apply_trip(trip, candidate)
        if action == "replace":
            for person in trip.participants:
                for segment in person.segments:
                    identity = (
                        person.traveller_id,
                        segment.country_code,
                        segment.start_date,
                        segment.end_date,
                    )
                    if identity in segment_ids[key]:
                        segment.id = segment_ids[key][identity]
            trip.version += 1
        db.add(trip)
        db.flush()
        after = trip_view(trip, catalogue)
        audit(
            db,
            session.user_id,
            trip.id,
            "IMPORT_REPLACE" if action == "replace" else "IMPORT",
            before.get(key),
            after,
        )
        affected.update(p.traveller_id for p in candidate.participants)
    if affected:
        invalidate_review(db, affected)
    db.commit()
    return {
        "imported_count": len(selected),
        "skipped_count": len(report["entries"]) - len(selected),
        "affected_traveller_ids": sorted(str(p) for p in affected),
    }
