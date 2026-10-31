# Travel exports — v1

Use **Export travel** below the calendar. Select an export format and either
traveller or both, choose **Preview export**, review the entries, then download.
CSV is for history; calendar history and saved plans are separate files. All
stored dates are included, independently of dashboard filters and calendar
baseline selections. Planned exports include excluded alternatives too.

The preview shows up to 50 country-segment entries and the full entry/trip counts.
The downloaded file is the exact snapshot prepared for that preview. Re-run the
preview to refresh it. Exporting never edits history, plans, profile declarations
or audit records. Profile notes, account credentials and sessions are excluded.
Exports contain traveller display names and trip details; they are not complete
database backups. History CSV import is available below exports. Two-way calendar synchronisation is not implemented.

## CSV schema 1

Files use UTF-8 (without a BOM), comma delimiters, CRLF record endings, RFC 4180
quoting, and ISO `YYYY-MM-DD` dates. Both segment start and end dates are inclusive.
There is one row per traveller per country segment. Shared trips and multi-country
itineraries therefore have multiple rows sharing `trip_external_id`.

| Column | Value |
| --- | --- |
| `schema_version` | `1` |
| `trip_external_id` | Stable UUID of the stored trip |
| `traveller_name` | Current display name (not an account/login name) |
| `trip_title` | Current trip title |
| `country_code` | Two-letter destination catalogue code |
| `segment_start` | Inclusive first country date |
| `segment_end` | Inclusive last country date |
| `trip_status` | Always `HISTORY` in CSV v1 |

```csv
schema_version,trip_external_id,traveller_name,trip_title,country_code,segment_start,segment_end,trip_status
1,12345678-1234-5678-1234-567812345678,Rich,France visit,FR,2026-05-01,2026-05-10,HISTORY
```

Names/titles that begin with `=`, `+`, `-`, `@`, including after whitespace, or
begin with a tab/newline/carriage return receive an apostrophe prefix. A literal
leading apostrophe is doubled so new exports can be imported without losing it. This makes
them literal cells when opened in a spreadsheet. The database text is unchanged.
These exports do not establish history completeness or rule applicability.

## iCalendar

[The iCalendar standard (RFC 5545)](https://www.rfc-editor.org/rfc/rfc5545) is
implemented using the [icalendar library](https://icalendar.readthedocs.io/en/latest/how-to/usage.html).
Each traveller-country segment becomes a separate all-day `VEVENT` with current
trip title, traveller name, country, explicit `HISTORY`/`PLANNED` description,
UTC `DTSTAMP`, private classification and a stable UID. History events have
`STATUS:CONFIRMED`; plans use `STATUS:TENTATIVE`, without asserting compliance.

`DTSTART;VALUE=DATE` is the inclusive first day. `DTEND;VALUE=DATE` is the day
after the inclusive last day. For example, a segment ending 10 May 2026 exports
`DTEND;VALUE=DATE:20260511`. No timezone conversion is applied to travel dates.
Text is escaped and UTF-8 content lines folded to the standard byte limit.
Invalid control characters are omitted from calendar text.

UIDs are `<segment UUID>@schengen-travel-planner.invalid`. A segment UUID belongs
to one trip/traveller. Unchanged country/date segments keep the same UID when the
trip or traveller is renamed and when a plan is explicitly confirmed as history.
Changing/removing a segment can produce/remove a UID. `SEQUENCE` increases with
trip/profile revisions. Calendar applications vary in how they handle re-import;
files do not automatically update or remove previously imported events.

## API

Authenticated `GET` endpoints:

- `/api/v1/exports/history.csv`
- `/api/v1/exports/history.ics`
- `/api/v1/exports/plans.ics`

Optional `traveller_id=<UUID>` selects one household traveller; omit it for both.
An unknown traveller is rejected. `export_date=YYYY-MM-DD` controls the date label
in the download filename. The browser sends its local current date; direct API
requests default to the server's current UTC date.

Normal responses have an attachment filename, `text/csv` or `text/calendar` UTF-8
content type, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.
Examples: `schengen-history-both-2026-10-29.csv` and
`schengen-plans-traveller-2-2026-10-29.ics`. Profile names never enter HTTP headers.

With `preview=true`, the same endpoint returns JSON containing `filename`,
`media_type`, `row_count`, `trip_count`, the first 50 `rows`, and full UTF-8 file
`content`. The frontend downloads this exact content as a browser-local file,
without re-querying data between preview and download. Empty CSV exports contain
headers only; empty ICS exports contain a calendar with no events. The UI explains
empty selections and does not offer an empty download.

## History CSV import

Choose **Import travel history**, upload a UTF-8 CSV (optional BOM), and preview.
Headers must match CSV schema 1 exactly, including order. All rows must have the
correct column count. ISO dates are strict; unknown countries, invalid dates,
gaps, duplicate segments, inconsistent trip titles and overlapping locations are
reported. Rows group by canonical UUID `trip_external_id`, then mapped traveller.
A traveller's entry/exit are the first/last segment dates; every date in between
must have a destination. Shared border dates retain the normal trip semantics.

Unambiguous current names match automatically; explicit mappings support changed
names and external files. Multiple CSV names cannot map to the same person within
one trip. Names and titles reverse the exporter's apostrophe protection; for hand
written files, prefix formula-like text with one apostrophe and double any literal
leading apostrophe. Older exports containing literal leading apostrophes can be
ambiguous; review the incoming title and mapping before committing.

Identical complete trips are skipped even when their external IDs differ.
An existing ID with different data offers explicit whole-trip replacement only
for history when all existing travellers remain present. The preview shows the
old and incoming itinerary. Other stored overlaps offer skip; correct the CSV or
edit stored history before retrying. Incoming alternatives that overlap are
flagged; select at most one. The commit validates the final selected batch and
rolls back everything if any conflict remains. No records are silently overwritten.
Unchanged segments retain their calendar event IDs during replacement.

Authenticated, CSRF-protected JSON endpoints:

- `POST /api/v1/imports/history/preview`: `content` (CSV text) and optional
  `traveller_mapping` (CSV display name to household traveller UUID).
- `POST /api/v1/imports/history/commit`: the same input, the returned `preview_token`,
  and `decisions` mapping every preview entry's `key` to one of its `allowed_actions`
  (`skip`, `import`, or `replace`).

Previews contain counts, resolved mappings, row-level grouping, validation/conflict
messages, allowed actions and incoming/existing itineraries. They do not write data.
The session-bound signed token covers the exact input, report and stored trip/profile
snapshot. It expires after 15 minutes. Stale/tampered previews return `409 IMPORT_STALE`;
preview again. No schema migration is required: staging is stateless and the original
input is resubmitted at commit. Raw CSV and preview tokens are not persisted.

Commits serialize against trip/profile edits, revalidate locations, preserve imported
UUIDs, audit each creation/replacement and clear the affected history declarations.
All writes share one database transaction. Reusing a successful token is rejected
as stale; re-previewing the same input reports committed history as duplicate, so a
lost response cannot cause a second insert. Files are bounded to 512,000 UTF-8 bytes
and 2,000 segment rows; JSON import requests are bounded to 1 MiB at API and proxy.
Other request bodies retain the existing 16 KiB limit.
