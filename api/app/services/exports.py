"""Read-only, versioned history CSV and separate all-day calendar snapshots."""

import csv
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from io import StringIO
from typing import Literal

from icalendar import Calendar, Event
from sqlalchemy import select

from app.models import Traveller
from app.services.travel import Catalogue, fail, load_trips

ExportType = Literal["history.csv", "history.ics", "plans.ics"]
CSV_COLUMNS = (
    "schema_version",
    "trip_external_id",
    "traveller_name",
    "trip_title",
    "country_code",
    "segment_start",
    "segment_end",
    "trip_status",
)


def spreadsheet_text(value: str) -> str:
    """Keep formula-like names/titles as literal cells, including whitespace prefixes."""
    if value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n", "'")):
        return "'" + value
    return value


def calendar_text(value: str) -> str:
    """Drop control bytes disallowed by RFC 5545; the library escapes line breaks."""
    return "".join(c for c in value if (ord(c) >= 32 and ord(c) != 127) or c in "\r\n\t")


@dataclass
class ExportDocument:
    filename: str
    media_type: str
    content: bytes
    rows: list[dict]

    def preview(self):
        return {
            "filename": self.filename,
            "media_type": self.media_type,
            "row_count": len(self.rows),
            "trip_count": len({row["trip_external_id"] for row in self.rows}),
            "rows": self.rows[:50],
            # Download this exact snapshot in the browser, even if another tab edits a trip.
            "content": self.content.decode("utf-8"),
        }


def export_document(db, export_type: ExportType, traveller_id, export_date):
    profiles = {p.id: p for p in db.scalars(select(Traveller).order_by(Traveller.slot))}
    if traveller_id is not None and traveller_id not in profiles:
        fail("UNKNOWN_TRAVELLER", "Choose an existing household traveller", 404)
    status = "PLANNED" if export_type == "plans.ics" else "HISTORY"
    catalogue = Catalogue(db)
    rows = []
    events = []
    stamp = datetime.now(UTC)
    for trip in load_trips(db, status=status):
        for person in trip.participants:
            if traveller_id is not None and person.traveller_id != traveller_id:
                continue
            profile = profiles[person.traveller_id]
            for segment in person.segments:
                country = catalogue.countries[segment.country_code]
                row = {
                    "schema_version": "1",
                    "trip_external_id": str(trip.id),
                    "traveller_name": profile.display_name,
                    "trip_title": trip.title,
                    "country_code": country.code,
                    "country_name": country.name,
                    "segment_start": segment.start_date.isoformat(),
                    "segment_end": segment.end_date.isoformat(),
                    "trip_status": trip.status,
                }
                rows.append(row)
                if export_type.endswith(".ics"):
                    event = Event()
                    # Segment IDs persist across renames and explicit confirmation as history.
                    event.add("uid", f"{segment.id}@schengen-travel-planner.invalid")
                    event.add("dtstamp", stamp)
                    event.add("dtstart", segment.start_date)
                    event.add("dtend", segment.end_date + timedelta(days=1))
                    event.add("sequence", trip.version + profile.version - 2)
                    kind = "History" if status == "HISTORY" else "Plan"
                    event.add(
                        "summary", calendar_text(f"[{kind}] {trip.title} — {profile.display_name}")
                    )
                    event.add("location", country.name)
                    event.add(
                        "description",
                        calendar_text(
                            f"Traveller: {profile.display_name}\nTrip: {trip.title}\n"
                            f"Country: {country.name} ({country.code})\n"
                            f"Trip status: {trip.status}\n"
                            f"Inclusive dates: {segment.start_date} to {segment.end_date}\n"
                            "One-way export. This event does not assess travel entitlement."
                        ),
                    )
                    event.add("status", "CONFIRMED" if status == "HISTORY" else "TENTATIVE")
                    event.add("class", "PRIVATE")
                    event.add("x-schengen-trip-status", trip.status)
                    events.append((row, event))

    def key(row):
        return (
            row["segment_start"],
            row["trip_external_id"],
            row["traveller_name"],
            row["country_code"],
        )

    rows.sort(key=key)
    if export_type == "history.csv":
        output = StringIO(newline="")
        writer = csv.writer(output, lineterminator="\r\n")
        writer.writerow(CSV_COLUMNS)
        for row in rows:
            writer.writerow(
                spreadsheet_text(row[column])
                if column in {"traveller_name", "trip_title"}
                else row[column]
                for column in CSV_COLUMNS
            )
        content = output.getvalue().encode("utf-8")
        media_type = "text/csv"
    else:
        calendar = Calendar()
        calendar.add("prodid", "-//Schengen Travel Planner//Travel Export v1//EN")
        calendar.add("version", "2.0")
        calendar.add("calscale", "GREGORIAN")
        for _, event in sorted(events, key=lambda item: key(item[0])):
            calendar.add_component(event)
        content = calendar.to_ical()
        media_type = "text/calendar"
    scope = f"traveller-{profiles[traveller_id].slot}" if traveller_id is not None else "both"
    kind, extension = export_type.split(".")
    filename = f"schengen-{kind}-{scope}-{export_date.isoformat()}.{extension}"
    return ExportDocument(filename, media_type, content, rows)
