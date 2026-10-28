# Schengen Travel Planner — Technical Specification

**Version:** 1.0  
**Date:** 28 October 2026  
**Status:** Proposed implementation design  
**Companion:** `Schengen_Travel_Planner_Functional_Specification.md`

## 1. Architecture decision
Build a self-hosted responsive SPA with **React + TypeScript + Vite**, a **FastAPI (Python 3.12+)** REST backend, **PostgreSQL 16+**, and a **Tailscale sidecar**. Use a reverse-proxy/web container (Caddy or Nginx) to serve the compiled SPA and forward `/api` to FastAPI. Deploy with Docker Compose. Use explicit UTC timestamps for audit metadata and **date-only** fields for travel; Schengen counting is by calendar dates, not elapsed hours or local time-zone conversions.

Why: typed client, easy touch-first calendar implementation, Python date arithmetic with deterministic testability, relational integrity and durable migrations. Use SQLAlchemy 2 + Alembic, Pydantic v2, pytest and Playwright.

## 2. Logical topology
```text
Phone / Desktop
     |
 Tailscale tailnet (private HTTPS via Tailscale Serve)
     |
 tailscale sidecar (network namespace owner)
     |
 web (SPA + /api reverse proxy) ---> api (FastAPI) ---> db (PostgreSQL)
                                       |
                               rolling-rule engine
```
All service ports remain internal to the Compose network or shared network namespace. No `ports:` mapping to host interfaces is required. The Tailscale container uses a persistent state volume and a **tagged, least-privilege auth key**; prefer a reusable key only when required by the deployment process, rotate and revoke as needed. Apply tailnet ACL/grants to restrict access to the household's approved devices. Tailscale is the transport boundary, not a substitute for application authentication.

### 2.1 Docker Compose reference
The following is an **illustrative baseline**; build context paths and reverse-proxy configuration must be supplied in the repository. The web container shares the sidecar's network namespace; `api` and `db` use the private backend network. Tailscale Serve must forward to `http://127.0.0.1:8080` within the sidecar namespace and TLS termination must be configured in the tailnet.

```yaml
services:
  tailscale:
    image: tailscale/tailscale:stable
    hostname: schengen-planner
    environment:
      TS_AUTHKEY: ${TS_AUTHKEY}
      TS_STATE_DIR: /var/lib/tailscale
      TS_USERSPACE: "true"
      TS_EXTRA_ARGS: --advertise-tags=tag:schengen-planner
    volumes:
      - tailscale-state:/var/lib/tailscale
      - ./tailscale/serve.json:/config/serve.json:ro
    command: ["sh", "-c", "tailscaled --state=/var/lib/tailscale/tailscaled.state & sleep 3; tailscale up --authkey=\"$TS_AUTHKEY\" --hostname=schengen-planner --advertise-tags=tag:schengen-planner; tailscale serve --bg --https=443 http://127.0.0.1:8080; wait"]
    networks: [backend]
    restart: unless-stopped

  web:
    build: ./web
    network_mode: service:tailscale
    depends_on: [tailscale, api]
    restart: unless-stopped

  api:
    build: ./api
    environment:
      DATABASE_URL: postgresql+psycopg://planner:${DB_PASSWORD}@db:5432/planner
      SESSION_SECRET: ${SESSION_SECRET}
    networks: [backend]
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: planner
      POSTGRES_USER: planner
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks: [backend]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U planner -d planner"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

networks:
  backend:
    internal: true
volumes:
  pgdata:
  tailscale-state:
```

**Production hardening:** replace the illustrative sidecar shell command with a pinned, tested Tailscale startup/Serve configuration (e.g. supported `TS_SERVE_CONFIG` mechanism for the selected image version); do not rely on a `sleep` race or store the auth key in the Compose file. Verify that `network_mode: service:tailscale` permits the web service to reach the API on the shared backend network and that the web server binds to `127.0.0.1:8080` or an appropriate namespace-local interface. Pin image digests, apply resource limits and read-only filesystem where practical. Store secrets in protected `.env`/secret mounts, not Git. The sidecar's auth key must be available on first enrolment and should be removable afterwards if persisted state permits.

## 3. Data model
Use UUID primary keys, `DATE` for entry/exit, `TIMESTAMPTZ` for created/updated/audit timestamps, foreign keys, uniqueness constraints and check constraints.

| Entity | Key fields | Notes |
|---|---|---|
| `household_user` | id, username, password_hash, created_at | Exactly one login initially; Argon2id hash |
| `traveller` | id, display_name, rule_applicability, notes | Exactly two active records in v1 |
| `country` | iso_3166_alpha2, name | Seeded catalogue, indexed name |
| `schengen_membership` | country_code, effective_from, effective_to, status | Date-aware membership, effective_to nullable; no overlapping validity intervals |
| `trip` | id, title, status, created_at, updated_at | `HISTORY` or `PLANNED`; audit revisions |
| `trip_participant` | trip_id, traveller_id, entry_date, exit_date | Participant-specific dates and inclusion |
| `trip_segment` | id, trip_id, traveller_id, country_code, start_date, end_date | Participant-specific destination dates; all dates inclusive |
| `plan_scenario` | id, title, reference_date, created_at | Saved optional baseline/scenario selection |
| `scenario_plan_inclusion` | scenario_id, trip_id, included | Explicit inclusion of saved plans |
| `audit_event` | id, actor_id, entity, entity_id, operation, before_json, after_json, occurred_at | Track edits without credentials |
| `import_job` | id, filename, checksum, status, report_json, created_at | Import preview and transaction status |

Constraints: entry_date <= exit_date; segment dates lie within that traveller's participant range; segment overlaps for a single traveller must be either rejected or explicitly reconciled if representing cross-border transitions on the same calendar date. History may include same-day cross-border segments, counted once. Prevent contradictory concurrent location records with validation and conflict-resolution UX. Unique `(trip_id, traveller_id)` in participant table.

## 4. Date and eligibility engine
### 4.1 Fundamental rule
For traveller `p` and assessed calendar day `d`, define `P(p)` as the **set of unique dates** on which the person was in the Schengen Area, combining confirmed history and the selected saved/proposed itinerary. Then:

```text
window(d) = [d - 179 calendar days, d] inclusive
used(p, d) = count({x in P(p) | d - 179 <= x <= d})
compliant(p, d) = used(p, d) <= 90
remaining(p, d) = max(0, 90 - used(p, d))
```

The inclusive dates of entry and exit count. No country-change reset. Dates are deduplicated before calculation. Non-Schengen dates are excluded; historical country membership is evaluated on each date. Do **not** calculate `90 - total days in the last six calendar months` or `90 - last 180 days at entry only`.

### 4.2 Evaluation algorithm
1. Load participant segments and country-membership intervals; expand to unique Schengen dates in a bounded range needed for the scenario and 179 days preceding it.
2. Create per-traveller immutable sets/bitsets of presence dates. Separate confirmed history from included planned trips.
3. Overlay the candidate trip **once**, ignoring duplicate dates already in the baseline; flag overlapping/conflicting plans separately.
4. For each candidate Schengen day, evaluate the inclusive rolling 180-day count; collect first breach and maximum usage.
5. Calculate the earliest date on/after the chosen search start with a legal **one-day** visit, and the earliest date allowing the **entire requested trip duration**. For multi-country itineraries preserve relative Schengen/non-Schengen day offsets.
6. Compute maximum uninterrupted Schengen stay from a selected entry date by testing sequential dates until the first breach, subject to an explicitly reported search horizon.
7. Return both traveller-specific assessments; a shared itinerary is acceptable only if both are compliant.

Use prefix sums over a daily boolean array for fast O(1) rolling-window queries after O(N) construction, where N spans the planning horizon plus 179 lookback days. For an assessment at day `d`, `used = prefix[d+1] - prefix[d-179]` with indices normalised to the array origin. Ensure enough lookback is loaded even if history display filters hide older records.

### 4.3 Important semantics
- **Calendar green** means a hypothetical one-day Schengen visit can be added to the selected baseline on that date without exceeding 90, not that a longer trip is permitted.
- **Purple** is planned presence, **blue** is confirmed historical presence, **red** marks violations, and **green** denotes eligible unbooked candidate days. For future historical records or past planned records, use explicit labels rather than infer solely from today's date.
- Saved plans are included only when explicitly selected; when assessing a saved plan, remove its own presence from the baseline before overlaying it to avoid double counting.
- A historical overstay is reported, not silently rewritten or ignored.
- If an itinerary contains no Schengen dates, status is `NOT_APPLICABLE`, not `PERMITTED`.
- Return `UNKNOWN` when history completeness is unconfirmed or a traveller's rule applicability is not established. Provide a user-controlled history-complete declaration with last-reviewed date.
- Time-zone differences do not alter date-only travel records; users enter the calendar date on which they cross the border.

### 4.4 Response example
```json
{
  "traveller_id": "uuid",
  "rule_applicable": true,
  "status": "OVER_LIMIT",
  "first_breach_date": "2027-04-15",
  "peak_rolling_days": 91,
  "remaining_at_entry": 3,
  "remaining_at_exit": 0,
  "maximum_contiguous_stay_days": 12,
  "earliest_one_day_entry": "2027-04-16",
  "earliest_full_trip_entry": null,
  "search_end_date": "2027-10-28",
  "warnings": ["Proposed stay exceeds the rolling allowance"]
}
```
Values above are **illustrative**, not a worked compliance example.

## 5. REST API (versioned `/api/v1`)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/login` | Authenticate, set secure HttpOnly session cookie |
| POST | `/auth/logout` | Revoke session |
| GET/PATCH | `/travellers` and `/travellers/{id}` | List/update two travellers |
| GET | `/countries?query=` | Search country catalogue with membership intervals |
| GET/POST | `/trips` | Filter/create history and plans |
| GET/PATCH/DELETE | `/trips/{id}` | Read/edit/delete with optimistic version check |
| POST | `/trips/{id}/confirm` | Convert plan to actual history after reviewing dates |
| POST | `/eligibility/evaluate` | Assess proposed itinerary and baseline selection |
| GET | `/eligibility/calendar` | Return per-day statuses for traveller(s), range and scenario |
| GET/POST | `/scenarios` | Manage saved scenarios |
| POST | `/imports/history/preview` | Parse/validate CSV; return conflicts and preview token |
| POST | `/imports/history/commit` | Commit validated import atomically |
| GET | `/exports/history.csv` | Export history CSV |
| GET | `/exports/history.ics` | Export confirmed history as ICS |
| GET | `/exports/plans.ics` | Export planned trips as ICS |
| GET | `/health/live` | Liveness |
| GET | `/health/ready` | Database readiness, private network only |

All state-changing endpoints enforce session auth, CSRF protection, request size limits and schema validation. Rate-limit login and imports. Return structured error codes (`INVALID_DATE_RANGE`, `OVERLAPPING_LOCATION`, `UNKNOWN_HISTORY`, `IMPORT_CONFLICT`, `RULE_NOT_APPLICABLE`) with actionable text. Use `409` for concurrent edit conflicts.

## 6. UI implementation
Use React Router, TanStack Query, React Hook Form and Zod, with a responsive calendar component (custom grid or well-maintained accessible library). CSS grid and container queries support 320 px to large desktop. Mobile-first layouts: dashboard cards stack, full-screen calendar switches between 12-month overview and month focus, sticky summary while editing, tap-start/tap-end selection, ≥44 px touch targets. Desktop: history table above planning workspace, split-pane date and result preview where space permits.

### 6.1 Calendar state model
Each date cell receives per-traveller `history_present`, `planned_present`, `is_violation`, `one_day_entry_eligible`, `used_days`, `remaining_days`, `non_schengen_trip` and accessible label. Render priority: violation red > confirmed history blue > planned purple > future one-day eligibility green > neutral. Combined mode uses two distinct sub-indicators per date, never a single merged allowance. Text labels, icons/patterns and legend ensure colour-independent interpretation. Respect `prefers-reduced-motion`.

### 6.2 Suggested components
`Dashboard`, `TravellerSummary`, `HistoryTable`, `TripEditor`, `CountrySegmentEditor`, `ScenarioPlanner`, `EligibilityResult`, `YearCalendar`, `MonthCalendar`, `DayDetailsSheet`, `ImportPreview`, `ExportPanel`, `Settings`, `AlertBanner`.

## 7. CSV specification
Use UTF-8 RFC 4180-style CSV with quoted fields when required and ISO `YYYY-MM-DD` dates. Proposed v1 columns:

```csv
schema_version,trip_external_id,traveller_name,trip_title,country_code,segment_start,segment_end,trip_status
1,TRIP-001,Traveller A,Spring France,FR,2026-04-01,2026-04-10,HISTORY
```

Multiple segment rows may share `trip_external_id` and traveller. Import preview validates headers, version, country codes, traveller mapping, segment consistency, duplicates, overlapping location records, and whether imported data conflicts with stored records. Normalise CRLF/LF; guard CSV formula injection in spreadsheet-oriented exports by safely prefixing formula-leading text values. Export only history for CSV v1. Import is staged then committed in one database transaction; no silent overwrite.

## 8. iCalendar specification
Generate RFC 5545-compliant `.ics`, `VCALENDAR` with one `VEVENT` per participant trip or per itinerary segment (choose **per segment** for accurate country labels). Use stable `UID` derived from trip/participant/segment, `DTSTAMP` UTC, `SUMMARY`, `DESCRIPTION`, `LOCATION` and all-day `DTSTART;VALUE=DATE:YYYYMMDD` and `DTEND;VALUE=DATE:YYYYMMDD` **one day after the inclusive exit date**. Include traveller and `HISTORY`/`PLANNED` in description; escape text and fold lines per RFC 5545. Generate separate files/endpoints for history and future plans; optionally filter by traveller. Avoid timezone-based `DTEND` off-by-one errors. Export only; do not imply two-way sync.

## 9. Security and operations
- Argon2id password hashes, server-side sessions with random identifiers, secure `HttpOnly`, `SameSite=Lax` or stricter cookies and CSRF tokens.
- HTTPS provided through Tailscale Serve; enforce trusted hosts, strict CORS (ideally same-origin only), CSP and safe headers.
- Tailnet ACL/grants limit device/user access; database has no published host port.
- Use dedicated unprivileged container users, minimal images, read-only mounts and dependency scanning.
- Encrypt backups at rest if copied off host; document PostgreSQL `pg_dump`/`pg_restore`, scheduled backup retention and restore verification.
- Structured JSON logs with request IDs; never log passwords, auth tokens or raw import contents.
- Alembic migrations run once during controlled deployment, not concurrently in multiple API replicas.
- Health checks, restart policy, pinning, and upgrade/rollback instructions in `README.md`.
- Record rule-engine version and catalogue version in evaluation responses to support reproducibility.

## 10. Testing strategy
### 10.1 Unit/property tests
- 90 consecutive Schengen dates pass; day 91 fails.
- 180-day inclusive window boundary; a date drops out precisely on day 181.
- Leap day, year-end, same-day entry/exit and non-Schengen gaps.
- Overlapping country segments count unique days once; contradictory locations flagged.
- Mixed historic membership dates and cross-border changes.
- Shared trips with participant-specific dates and distinct earlier travel.
- Saved plan included/excluded, self-evaluation without double counting.
- First breach occurs after entry; earliest legal entry for a duration differs from earliest legal one-day entry.
- Randomised/property-based comparison of optimised prefix sums against a simple reference implementation.

### 10.2 Integration and E2E
- CSV preview/rollback/conflict resolution, CSV formula injection and import idempotency.
- ICS all-day dates, stable UIDs and escaped text validated by a standards-compliant parser.
- Auth, CSRF, access control, session expiry, rate limits and protected export endpoints.
- Mobile Safari and Chrome touch flows, keyboard-only use, screen reader names, 320 px layout and colour contrast.
- Container restart, database backup/restore, Tailscale enrolment/re-enrolment and tailnet-only reachability.

### 10.3 Performance targets
For two travellers and 2,000 records, target p95 API evaluation <500 ms and calendar API <1 s on a modest home server; benchmark and tune before release. Cache derived day sets by traveller, source revision and scenario hash, invalidated on edits.

## 11. Repository layout
```text
schengen-planner/
  compose.yaml
  .env.example
  README.md
  docs/
    functional-spec.md
    technical-spec.md
    csv-schema.md
  tailscale/
    serve.json
  web/
    Dockerfile
    src/components/
    src/pages/
    src/api/
  api/
    Dockerfile
    app/api/v1/
    app/models/
    app/services/eligibility.py
    app/services/import_export.py
    alembic/
    tests/
  tests/e2e/
  scripts/backup.sh
  scripts/restore.sh
```

## 12. Delivery phases
1. Repository, Compose, Tailscale private access, login and database migrations.
2. Traveller profiles, country catalogue, trip CRUD and history dashboard.
3. Rolling 90/180 engine, scenario inclusion and traveller-specific compliance endpoints.
4. Future planner, 365-day horizon and responsive combined calendar.
5. CSV import/export, separate ICS history/plan exports and audit logging.
6. Accessibility, security hardening, edge-case tests, performance, backup/restore and release documentation.

## 13. Implementation cautions
- The 90/180 rule is not necessarily applicable to all travellers or travel purposes. The software must not claim to handle visas, residency or exceptional arrangements.
- Source-of-truth travel records should remain editable and traceable; never silently move provisional plans into history.
- Country membership needs date-aware reference data and a controlled update process, not a hard-coded current-country list.
- Do not interpret a green entry date as permission for an arbitrary stay.
- The example Compose file requires repository-specific configuration and validation before production deployment.

## 14. Definition of done
A fresh deployment on a Docker host can enrol the Tailscale node, authenticate one household account, manage two independent travellers, evaluate complete proposed itineraries under inclusive rolling windows, display accessible calendar status, import/export history CSV, export separate history and plan ICS, survive restarts, and restore data from backup. Automated tests and operational instructions accompany the release.
