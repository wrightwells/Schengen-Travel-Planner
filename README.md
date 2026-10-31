# Schengen Travel Planner

A private, self-hosted planner for two travellers with separate rolling 90/180-day
allowances. Built with React/TypeScript, FastAPI and PostgreSQL.

**Development milestone 4:** household sign-in, persistent editable traveller names,
audited travel history, multi-country shared trips, independent allowance summaries,
a live future planner with saved plans, and month/year calendars with independent
traveller indicators, tap-to-plan date ranges, and previewed CSV/calendar exports plus transactional history CSV imports.
Both profiles start with the standard rule enabled. History completeness must be explicitly reviewed; adding, editing or
deleting history clears the affected reviews. Persisted named scenarios are still to come.
See [development status](docs/development-status.md) for scope and next steps.

## Local development

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), Node 22.12+ or 24, and npm.
SQLite below is a disposable local-development option; deployment uses PostgreSQL.
Run the API and frontend in separate terminals.

```bash
cd api
uv sync --frozen --python 3.12
export DATABASE_URL=sqlite:///./development.db
export COOKIE_SECURE=false
uv run alembic upgrade head
uv run python -m app.bootstrap
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --reload
```

The bootstrap command prompts for your own household username/password. It refuses
to replace an existing account and creates exactly two profiles: Traveller A and
Traveller B. Profile names are editable and saved in the database.

```bash
cd web
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` to the loopback API; no CORS
exception is needed. `COOKIE_SECURE=false` is only for this loopback HTTP setup.
Never use this setting for the Tailscale HTTPS deployment.

## Checks

```bash
cd api
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
cd ../web
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start disposable API/database and Vite processes, test desktop and
320px mobile flows, and stop them afterwards. They use ports 18080 and 15173.
To use an existing Chrome installation instead of downloading Chromium:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:e2e
```

## Version 1 web release

Release [`v1.0.0`](https://github.com/wrightwells/Schengen-Travel-Planner/releases/tag/v1.0.0)
is named **version 1 web**. GitHub Actions tests the app, compiles the frontend,
and publishes the API and web images to GitHub Container Registry. Images target
Linux amd64. The release includes the compiled frontend archive and Compose files.
The frontend archive needs the API proxy in `web/nginx.conf`; it is not a standalone app.

For a loopback deployment using the release images:

```bash
cp .env.example .env
chmod 600 .env
# Set a random URL-safe DB_PASSWORD in .env.
# For private packages, first authenticate with a token with read:packages access:
# export GHCR_TOKEN=...  # supply securely; do not commit it
# printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
docker compose -f compose.example.yaml config --quiet
docker compose -f compose.example.yaml pull
docker compose -f compose.example.yaml up -d
docker compose -f compose.example.yaml exec api /app/.venv/bin/python -m app.bootstrap
```

Open <http://localhost:9067>. The example binds to loopback and keeps its data in
`schengen-planner-example_pgdata`. It uses HTTP cookies for local access; set
`PLANNER_COOKIE_SECURE=true` and `PLANNER_TAILSCALE_HOST` when placing it behind
Tailscale HTTPS. `compose.yaml` provides the private Tailscale topology using the
same release images; `compose.local.yaml` continues to build from source.
Back up existing data before upgrading, run the migration service, then recreate
the API and web services. Keep the same Compose project name and volume when
upgrading an existing deployment. Do not use `down -v` to upgrade.

To publish another version, update the app versions and image tags in the release
Compose files, commit, and push a matching `vX.Y.Z` tag. The release workflow only
publishes the GitHub Release after checks and both container builds succeed.

## Container deployment foundation

### Local Docker on port 9067

The local configuration runs independently of Tailscale and persists PostgreSQL
data in the `schengen-planner-local_pgdata` Docker volume. It binds to loopback.
Set a random `DB_PASSWORD` in a protected `.env.local` file, then run:

```bash
docker compose --env-file .env.local -f compose.local.yaml up --build -d
docker compose --env-file .env.local -f compose.local.yaml exec api /app/.venv/bin/python -m app.bootstrap
```

Open <http://localhost:9067>. For an already-provisioned account, skip bootstrap.
The initial local deployment credentials are stored in the ignored, owner-only
`.local-credentials.local` file when provisioned by the development assistant.

To stop without deleting data:

```bash
docker compose --env-file .env.local -f compose.local.yaml down
```

Before upgrading, back up the database. For example, with a private `backups/`
directory (ignored by Git):

```bash
mkdir -p backups
chmod 700 backups
docker compose --env-file .env.local -f compose.local.yaml exec -T db pg_dump -U planner -d planner -Fc > backups/local.dump
chmod 600 backups/local.dump
docker compose --env-file .env.local -f compose.local.yaml up --build -d
```

The one-shot migration service upgrades existing data before starting the API.
Never use `down -v` when you intend to preserve household data.

For mobile testing of the existing local database through the host's Tailscale
connection, set `PLANNER_TAILSCALE_HOST` to the host's exact `*.ts.net` name and
`PLANNER_COOKIE_SECURE=true` in `.env.local`, then recreate the local API service.
Run `tailscale serve --bg --https=8443 http://127.0.0.1:9067` and open
`https://<PLANNER_TAILSCALE_HOST>:8443/` from a device connected to the same tailnet.
This preserves existing Serve routes on port 443. Disable this route with
`tailscale serve --https=8443 off`. Secure cookies require HTTPS for authenticated
remote access; to return to plain local HTTP testing, restore
`PLANNER_COOKIE_SECURE=false` and recreate the API service.

### Private Tailscale deployment

This topology is under development and is not yet a release deployment. Do not
load real travel data until backups/restore and the remaining workflows are ready.

1. Copy `.env.example` to `.env`, restrict it with `chmod 600 .env`, and set a
   random **URL-safe** `DB_PASSWORD` (e.g. `openssl rand -hex 32`).
2. Set the exact tailnet hostname in `ALLOWED_HOSTS`. Configure the
   `tag:schengen-planner` tag, household-only grants and tailnet HTTPS first.
3. Supply a Tailscale enrolment key in `TS_AUTHKEY`. Persisted node state allows
   removing the key after successful enrolment.
4. Authenticate to GHCR if needed (as above), pull and start the release containers,
   then provision the account interactively:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose run --rm api /app/.venv/bin/python -m app.bootstrap
```

Open the node's `https://schengen-planner.<your-tailnet>.ts.net` address from an
authorised household device. There are **no published host ports**. Tailscale Serve
terminates HTTPS and forwards to the web container in its shared network namespace.
Only Tailscale has an egress network; API and PostgreSQL use the internal backend.
Funnel is disabled. This uses the supported
[Tailscale Docker Serve configuration](https://tailscale.com/docs/features/containers/docker).

Migrations run in a separate one-shot service before the API starts. The API never
creates its own schema at startup. On upgrade, back up the database and run
`docker compose run --rm migrate` before recreating the API. Image digest pinning,
end-to-end tailnet checks and documented backup/restore are release gates still
to complete; see the development status document.

## Today's allowances

Household allowance summaries automatically use today's browser-local date. There
is no editable allowance reference-date control. The date stays current across
midnight and when returning to the page. Each profile still shows the date its
summary covers. Calendar dates have their own rolling counts, and proposed trips
are assessed against their actual travel dates.

## Add and edit trips

Enter one entry date, one exit date and one destination itinerary for a trip.
Use **Who is travelling?** to choose either traveller or both. The same dates and
country segments apply to each selected person; their allowance calculations,
history declarations and calendar indicators remain separate. Adding/removing a
traveller keeps the entered itinerary, even when no travellers are temporarily
selected. At least one traveller is required to save.

The same editor is used for history, saved plans, calendar-created drafts,
duplication and confirming actual travel. Existing records with different dates
or destinations are preserved when opened or cancelled. Editing one of those
records shows the original itineraries and asks which shared itinerary to apply
before saving. The API and CSV formats retain per-person records for compatibility;
no existing travel data is automatically converted.

## API currently available

All household data endpoints require an authenticated server-side session.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/auth/login` | Sign in with username/password JSON |
| `GET /api/v1/auth/session` | Restore session and obtain CSRF token |
| `POST /api/v1/auth/logout` | Revoke session |
| `GET /api/v1/travellers` | Read the two profiles |
| `PATCH /api/v1/travellers/{id}` | Save profile with version check and audit event |
| `GET /api/v1/countries?query=` | Search date-aware country catalogue |
| `GET/POST /api/v1/trips` | Filter or create history and saved plans |
| `GET/PATCH/DELETE /api/v1/trips/{id}` | View, replace or delete a versioned trip |
| `POST /api/v1/trips/{id}/confirm` | Explicitly confirm actual traveller dates |
| `GET /api/v1/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD&reference_date=YYYY-MM-DD` | Daily per-person usage and explicit selected-plan baseline (up to 366 dates) |
| `GET /api/v1/eligibility/summary?reference_date=YYYY-MM-DD` | Separate allowance summaries; confirmed history only |
| `POST /api/v1/eligibility/evaluate` | Assess each traveller against history and selected saved plans |
| `POST /api/v1/imports/history/preview` | Validate history CSV, map travellers and review conflicts |
| `POST /api/v1/imports/history/commit` | Atomically import or explicitly replace reviewed history |
| `GET /api/v1/exports/history.csv` | Confirmed history CSV, one row per traveller/country segment |
| `GET /api/v1/exports/history.ics` | Confirmed history all-day calendar |
| `GET /api/v1/exports/plans.ics` | Saved plans all-day calendar, separate from history |
| `GET /api/v1/health/live` | Liveness and application version |
| `GET /api/v1/health/ready` | Database/schema readiness |

All mutations require `X-Requested-With: SchengenPlanner`. Authenticated mutations
also require `X-CSRF-Token` from the sign-in/session response. Cookies are HttpOnly,
SameSite=Strict and Secure by default. Sessions expire after 12 hours. Five failed
attempts lock the household login for 15 minutes. Credentials and session tokens
are excluded from access logs; no trackers or external fonts are used.

Trip payloads contain a `title`, `status` (`HISTORY` or `PLANNED`) and one or two
`participants`. Each participant has a `traveller_id`, `entry_date`, `exit_date`
and country `segments` (`country_code`, `start_date`, `end_date`). Every itinerary
day must have a destination. Only a single shared boundary day between different
countries may overlap. Trip edits send the current `version`; deletes require
`?version=N`. Confirmation posts the reviewed trip with `status=HISTORY` and its
version to `/confirm`. These operations retain an audit trail.

Evaluation accepts `candidate` (a trip payload), `included_plan_ids` (defaults to
none), `exclude_trip_id` (only the saved plan currently being edited) and a bounded
`search_days` (default 365). Saved plans never automatically consume allowance.
Full-itinerary searches preserve country segments, recheck membership on shifted
dates and reject conflicts with selected baseline travel. The maximum continuous
stay metric measures rule capacity; other booked destinations must also be checked.
See the [catalogue coverage and primary sources](docs/country-catalogue.md).

## Specifications

- [Functional specification](Schengen_Travel_Planner_Functional_Specification.md)
- [Technical specification](Schengen_Travel_Planner_Technical_Specification.md)

This application is a planning aid. Immigration status and exceptions can alter
entitlement; calculations are not a border or immigration decision.

## Calendar

The Travel calendar provides month, year and Gantt views, Monday-first weeks, separate
traveller indicators, inclusive range selection and daily trip details. Confirmed
history always appears. **Include in scenario** on each saved plan controls whether
that plan appears on the calendar and counts towards allowance calculations.
Multiple included plans appear together. Excluded plans are hidden. The scenario
selection and displayed month are remembered in this browser. Opening, cancelling
or saving an edit preserves the scenario selection. The editor excludes its own
saved copy from assessment without changing that selection.

Use the visible **Month view**, **Year view** and **Gantt view** buttons to switch layouts.
Gantt view scrolls horizontally across the selected year, with month headers,
Monday-based week sections, per-traveller daily usage and recorded trip bars.
Each traveller has one **Travel** row containing all their trip bars, with trip
names and dates inside the bars. Traveller and row labels stay visible while scrolling. Select daily counts to
inspect dates or choose a range, or select a trip bar to inspect its first date.
The traveller filter and scenario checkboxes apply to this view as well.
Year view shows all 12 months and has a year picker; Previous/Next steps through
years. Your view choice is remembered after refreshing. Month view has a month
picker for browsing past and future dates. There is no separate trip selector in the calendar. Dates with history or an included scenario trip for the visible travellers have
darker two-pixel borders. Unbooked dates have light borders, including dates with
available allowance. Today is underlined; range selection uses a background tint
and the inspected date has a dashed outline. Empty calendar spaces and unsupported
dates have no dark border. Supported dates
run from 22 April 2013 through 31 December 2100; dates before 18 October 2013 are
displayed without a modern-rule assessment.

Calendar badges show each traveller's **used Schengen days in the rolling 180-day
window ending on that date**, including confirmed history and selected scenario
plans. They display numbers such as `23`, without traveller-number prefixes or
H/P codes. Rows follow the traveller names listed above the calendar; filtering
shows just that person's count. Counts may be incomplete until history is reviewed.

Colours distinguish history, selected plans, breaches, non-Schengen bookings and
availability. Tooltips and day details identify the person, booking type and
assessment status. Red counts show over-limit dates, green indicates one-day entry
capacity, and unknown/unassessed profiles never receive green availability. Day
counts deduplicate country transition dates. With no plans included, the calendar
shows history only and explains how to include a plan.

Tap a start date and an end date, then **Plan selected dates** to populate the
itinerary editor for the visible travellers. Destinations still need review before
a plan can be assessed or saved. Uninterrupted-stay figures measure rule capacity;
other booked locations still need checking.

The authenticated calendar API accepts repeated `included_plan_ids` parameters,
rejects stale plan IDs and conflicting selected itineraries, and returns up to 366
dates per request. Browser-local today is sent as `reference_date` so server
timezone does not shift future availability.

## Export travel

Use **Export travel** below the calendar to choose history CSV, history calendar
(.ics), or planned-trip calendar (.ics). Select Rich, Coz, or both using the current
profile names, choose **Preview export**, and download the reviewed snapshot.
Each country segment is a separate CSV row/calendar event. All stored dates are
included; dashboard filters and calendar scenario selections do not limit exports.
History and plans remain separate. Preview lists up to 50 entries, while downloads
include every matching entry.

Files contain trip details and traveller names, with ISO dates and dated download
filenames. CSV formula-like text is neutralised for spreadsheet use. Calendar
events have stable IDs and inclusive dates represented by an exclusive next-day
end, with provisional plans labelled explicitly. These are one-way exports and
are not complete database backups. History CSV can be re-imported using the reviewed import workflow below.

See [export formats, identity policy and API](docs/exports.md).

## Import travel history

Use **Import travel history** below exports. Choose a UTF-8 history CSV in the
schema shown in [export/import formats](docs/exports.md), then **Preview import**.
Names match current profiles automatically when unambiguous. Map old or external
names to either traveller and preview again. Review incoming itineraries and each
trip's action, then **Commit selected trips**.

New valid trips start selected for import. Duplicates, invalid entries and
conflicts start skipped. A changed trip with the same external ID can be explicitly
replaced after reviewing its existing itinerary. Replacement rewrites the whole
trip and cannot remove an existing traveller; a single-traveller export cannot
silently erase the other traveller's records. Other location conflicts must be
skipped or corrected in the CSV/history editor. Plans cannot be replaced by import.

Each selected batch commits together, with audit events and affected history
reviews cleared. Any failure rolls back the whole batch. Previews expire after
15 minutes and require refreshing after any stored trip or profile changes.
If a connection fails during commit, preview the same file again: committed trips
are reported as duplicates. The limit is 512 KB and 2,000 country-segment rows per
file. There is no calendar import or complete-database restore through this panel.
