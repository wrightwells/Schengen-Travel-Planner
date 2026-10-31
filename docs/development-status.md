# Development status

## Milestone 4 — travel export and import

Implemented:

- Household login, server-side sessions, CSRF protection, persistent editable
  traveller names and optimistic profile edits from milestone 1.
- Versioned country catalogue stored in PostgreSQL with explicit date intervals,
  source documentation, European/overseas scope notes and searchable destinations.
  Coverage starts 22 April 2013; modern-rule assessments start 18 October 2013.
- Audited trip create/read/edit/delete, with version checks, a shared date/itinerary editor and participant selection
  for either or both household travellers. Stored per-person records remain supported.
- Validation for full itinerary coverage, unknown destinations/travellers,
  duplicate participants/segments and conflicting recorded locations. A shared
  boundary date between different countries is permitted and counted once.
- Upper Travel History panel: traveller, country, year and date-range filters,
  newest-first rows, inclusive dates, destinations and per-person Schengen totals.
- Separate confirmed-history allowance summaries using today's local date.
  Completeness must be explicitly reviewed; edits/deletions/additions clear the
  affected declarations and increment profile versions.
- Lower future planner: live assessment of each traveller, full itinerary checks,
  first breach, peak usage, remaining allowance and bounded entry/stay searches.
- Save/edit/duplicate/delete plans, explicit baseline inclusion/exclusion and
  confirmation as history only after reviewing actual dates.
- Date shifts re-resolve membership and check baseline location conflicts. Editing
  a saved plan removes its own original presence; history cannot be excluded.
- Local Docker configuration on http://localhost:9067 with persistent PostgreSQL.
- Authenticated bounded calendar API, confirmed history plus explicitly selected
  plans, daily independent usage and rule-capacity figures, date-aware membership,
  neutral non-Schengen bookings and conflict detection.
- Month/year calendar views, separate traveller indicators, visible symbol/colour
  legend, numeric day details and inclusive tap-start/tap-end draft planning.

- Read-only history CSV and separate history/plan iCalendar exports, selectable
  by either traveller or both, with previews and exact snapshot downloads.
- Versioned CSV schema, formula protection, UTF-8 escaping, all-day exclusive
  calendar end dates, stable segment event IDs and documented export semantics.

## Validation

- Backend: 59 tests covering the original engine/security cases plus catalogue
  boundaries, CRUD/audit/version conflicts, shared trips, validation rollback,
  saved-plan baselines, confirmation, shifted accession-date searches, calendar
  plan inclusion, independent capacity, conflicts, leap days and membership changes.
  Export tests cover authentication, filters, CSV safety, parser-validated calendars,
  UTF-8 line folding, exclusive end dates, event identity and bounded previews.
- Python lint/format checks and the TypeScript/Vite production build pass.
- The shared-date build passed all 20 browser checks on desktop and 320px mobile, including leap-year
  navigation, baseline markers and tap-range planning. Browser fixtures use
  disposable databases only. Migration round-trip/schema checks pass in SQLite.

## Local deployment — 28 October 2026

Version 0.3.0 is deployed at http://localhost:9067. The PostgreSQL volume was
preserved; a protected pre-upgrade archive and its readable table of contents are
in `backups/pre-calendar-20261028.dump` and `.contents`. The migration service
completed successfully, API readiness passes, and PostgreSQL is healthy. A live
check verified authentication is required, the signed-in calendar returns 365
dates independently for both profiles, and deployed frontend assets match the
production build. No travel data was changed by this check.

## Next development work

1. Dedicated full-page calendar navigation and further accessibility refinement.
2. Persisted named scenarios and account-wide baseline selections (included plan
   IDs and calendar month are currently remembered in each browser).
3. Settings for rule applicability, thresholds, week start and password changes;
   audit viewing, visible backup/export workflows and verified restore procedure.
4. Full accessibility, property/performance benchmarks, release hardening and
   actual tailnet enrolment/HTTPS/access-control verification.

## Current limits

- This is a development build, not the full release definition in the specs.
- Calendar year view covers a selected calendar year; month view supports direct
  month selection. Supported calendar dates are 22 April 2013–31 December 2100. A dedicated calendar page and
  configurable week start remain to implement.
- Maximum uninterrupted stay reports rule capacity. It does not reserve new dates
  or cancel other destinations; review other saved travel before booking.
- Entry suggestions exclude conflicting selected itineraries. One-day suggestions
  exclude occupied baseline dates; they are not unconditional permission for a
  longer stay. Country assumptions remain those of the reviewed catalogue.
- The pure engine uses sorted unique ordinals and binary searches rather than
  prefix arrays; benchmark the persisted 2,000-record target before release.
  Baseline date expansion is bounded to the relevant lookback/search interval.
- Profile completeness is a user declaration about all relevant travel, including
  periods of no travel; absence of records does not establish completeness.
- Unchanged segments retain IDs across trip rename/confirmation; edited/replaced
  segments receive new IDs. See [export identity policy](exports.md); one-way files
  cannot automatically remove events already imported into another calendar.
- Image digest pinning, automated reference-data updates, full backup restoration
  and the private Tailscale deployment remain release gates. No public deployment
  or tailnet enrolment has been performed.

See [country catalogue sources and coverage](country-catalogue.md), the README and
both root specifications for the current implementation baseline.

## Calendar visibility fix — 29 October 2026

The calendar initially added a direct saved-trip selector and jumps to that trip's
entry month. Included plan IDs and the visible month survive a browser reload.
History-only mode clearly states that no saved trips are assessed. Red breach
markers have a stronger edge and visible per-person warning summaries; amber 0
markers distinguish unbooked dates without one-day allowance. No travel records
are changed by selecting a scenario.

Version 0.3.1 passes all 10 desktop/mobile browser checks, including separate
breach dates, history-only capacity markers, trip selection and reload persistence.
The production container build and Python lint/format checks pass. The pre-upgrade
database backup is `backups/pre-calendar-visibility-20261029.dump`.

## CSV import continuation — 29 October 2026

Added a history CSV upload/mapping/preview/commit workflow alongside existing
CSV and calendar exports. Validation reports invalid data, duplicates, stored
conflicts and conflicting incoming alternatives. Users can skip entries or
explicitly replace same-ID history after reviewing both itineraries. Partial
shared exports cannot remove another traveller. Session-bound previews expire
and reject intervening edits. Selected batches validate and commit atomically,
preserve segment IDs, write audits and invalidate affected completeness reviews.
Preview staging is stateless; it does not require a database migration.

Imports accept up to 512 KB / 2,000 segment rows with matching container proxy
limits. CSV export now escapes literal leading apostrophes for reversible import.
This work was subsequently deployed locally with the calendar changes below.

## Calendar visibility and controls — 29 October 2026

The final calendar uses **Include in scenario** on saved plans as its single
control for planned-trip visibility and allowance calculations. Confirmed history
always appears. Multiple included plans appear together; excluded plans are hidden.
The extra trip-jump and plan-assessment selectors have been removed. Scenario
choices and the visible month remain remembered in the browser.

Calendar browsing covers all supported stored dates, from 22 April 2013 to
31 December 2100. Dates preceding the modern-rule assessment period remain
unassessed. Date cells have darker two-pixel borders and stronger today/range
outlines in month and year views, including mobile.

The temporary `show_all_plans` API option and outlined markers for excluded plans
have been removed. Calendar tests cover history visibility, scenario toggles,
independent usage/breaches, reload persistence, supported date boundaries, date
borders and month/year views on desktop and 320px mobile. These changes were subsequently deployed locally as recorded below.

## Local deployment refresh — 29 October 2026, 16:50 UTC

Rebuilt and recreated the local web/API containers to serve the scenario-controlled
calendar. The running frontend now serves `index-MmXwF55R.js`; the obsolete trip
selector strings are absent. Migration completed, API readiness passes and the
PostgreSQL volume was preserved. Before/after counts are unchanged: 6 trips,
9 participants, 9 segments, 2 profiles and 18 audit events.

The private pre-upgrade database backup is
`backups/pre-scenario-calendar-20261029T165022Z.dump`; its archive table of contents
was validated and saved alongside it. No household travel records were changed.

## Visible year view and valid-date borders — 29 October 2026

Replaced the calendar view dropdown with explicit **Month view** / **Year view**
buttons. The active view persists across refreshes. Year view shows all 12 months,
provides a dedicated year picker and advances by year with Previous/Next. Fixed
navigation back to the earliest supported year. Dates before catalogue coverage
are disabled and borderless; empty calendar slots have no border or shadow.
Selectable dates retain the darker border in both layouts.

Only the frontend needs updating for this change; scenario choices, allowance
calculations and travel records are unchanged.


The frontend was rebuilt and deployed to http://localhost:9067 after all six
calendar browser checks passed on desktop and 320px mobile. The served frontend
is `index-X6nx0lFd.js`. The API/database containers were not recreated for this
frontend-only update.

## Travel-date border clarification — 29 October 2026

Dark date borders now indicate a date with recorded history or a planned trip
included in the scenario for a visible traveller. Unbooked dates have light borders,
regardless of allowance availability. Toggling scenario inclusion or the traveller
filter updates the border. Today uses an underline, range selection uses a tint,
and the inspected date uses a dashed outline, so those states cannot suggest a
booking through a dark border. Month and year views use the same rule.


This clarification was deployed to http://localhost:9067 after the production build
and all six desktop/mobile calendar browser checks passed. The served frontend is
`index-BJiOMsMo.js`. Only the web container was replaced.

## Scenario selection survives editing — 29 October 2026

Fixed a visibility bug where opening a saved plan silently removed it from the
scenario, leaving it hidden even after cancelling. Plan edits now preserve the
scenario checkbox through opening, saving, cancelling and refreshing. Assessment
still excludes the saved copy of the plan being edited via `exclude_trip_id`, so
it is not assessed twice. Explicit confirmation as history removes its obsolete
plan selection while continuing to display the confirmed travel.

The checkbox consistently reads **Include in scenario**, matching the calendar
instructions. Regression coverage uses 14 March–4 April 2027 and verifies 22
inclusive dates in year view, 18 in March and 4 in April, plus independent
assessment and persistence through editing and reload. Existing selections that
were previously cleared require rechecking the checkbox in that browser.


The fix was deployed locally after the production build and all 18 desktop/mobile
browser checks passed. The served frontend is `index-FF24Up72.js`. The actual saved
Spring 27 plan was checked through the read-only calendar API: all 22 dates are
present when included. No saved travel dates were edited during diagnosis or deployment.

## One itinerary per trip editor — 29 October 2026

Adding/editing history or plans now presents one entry/exit pair and one destination
itinerary. Traveller checkboxes decide who those dates and segments apply to.
Toggling participants preserves entered dates, including when all checkboxes are
temporarily cleared. The planner still assesses each selected person independently.
Calendar-created drafts, duplicate plans and explicit history confirmation use the
same shared editor. Supported entry/exit dates align with stored dates through 2100.

For older trips with different per-person dates or destinations, the editor shows
read-only original itineraries and a source choice. Applying the shared itinerary
requires explicit review before saving; cancelling changes nothing. The persisted
API/CSV schema remains compatible and no records are automatically migrated.
Browser regression coverage verifies one date pair, shared country segments,
participant add/remove, independent assessments, calendar draft creation, confirmation,
and preservation/review of older distinct itineraries.


The shared editor was deployed to http://localhost:9067 after the production build
and all 20 desktop/mobile browser checks passed. The served frontend is
`index-BjvMAbAE.js`. Only the web container was recreated; no travel records were
converted or edited during deployment.

## Travel data reset — 29 October 2026

At the user's explicit request, cleared all history/planned trips, trip participants,
country segments and audit records in a single database transaction. The existing
household login, two traveller profiles and country reference data were retained.
History completeness/review dates were reset and profile versions incremented.
No travel records or audit events remain. Browser-local scenario selections are
filtered against the empty trip list on refresh.

A verified private recovery backup remains at
`backups/pre-data-reset-20261029T194055Z.dump` with its validated table of contents.
Backups are separate files and were not deleted by this database reset.

## Automatic today and numeric calendar counts — 29 October 2026

Removed the household allowance reference-date input. Summaries now use the
browser-local current date automatically, refreshing across midnight and on
return to the page. Profile summaries retain their read-only as-of date. Calendar
reference dates use the same current-day behavior; trip assessments still use the
candidate itinerary dates.

Calendar badges now show the numeric used-day count in the rolling 180-day window
ending on each date, including confirmed history and selected scenario plans.
Removed person-number and H/P/symbol codes from day badges and the legend. Named
row-order guidance, booking/status colours, accessible descriptions and day details
retain the distinction between travellers, history/plans and assessment status.
Incomplete-history warnings remain visible. Regression checks cover separate
92/50-day counts, shared two-day counts and a 1-to-22-day scenario across months.


The automatic-date/numeric-count frontend was deployed to http://localhost:9067;
the served asset is `index-DSsffgAj.js`. The production/container build passes.
A focused low-memory live-browser check verified removal of the date control,
automatic today-based summary requests, numeric 92/50 day counts in month/year
views, named traveller filtering, and 320px layout. Sample calendar responses were
confined to the temporary browser; no database travel records were created or edited.

The full browser suite could not complete under severe host memory/swap pressure:
one run timed out during server startup and another timed out in browser setup.
It was stopped rather than repeatedly restarting workers. These failures occurred
before the new assertions; a full-suite rerun remains pending when resources recover.
