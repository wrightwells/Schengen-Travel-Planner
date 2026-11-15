# API reference

All household data endpoints require an authenticated server-side session.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/auth/login` | Sign in with username/password JSON |
| `GET /api/v1/auth/session` | Restore session and obtain CSRF token |
| `POST /api/v1/auth/logout` | Revoke session |
| `GET /api/v1/trips/{id}/proofs` | List private proof documents for confirmed history |
| `POST /api/v1/trips/{id}/proofs?filename=...` | Upload raw document bytes as `application/octet-stream` (10 MiB maximum) |
| `GET /api/v1/trips/{id}/proofs/{proof_id}` | Download proof as an authenticated attachment |
| `DELETE /api/v1/trips/{id}/proofs/{proof_id}` | Permanently remove a proof document (CSRF required) |
| `GET /api/v1/travellers` | Read the two profiles |
| `PATCH /api/v1/travellers/{id}` | Save profile with version check and audit event |
| `GET /api/v1/countries?query=` | Search date-aware country catalogue |
| `GET/POST /api/v1/trips` | Filter or create history and saved plans |
| `GET/PATCH/DELETE /api/v1/trips/{id}` | View, replace or delete a versioned trip |
| `POST /api/v1/trips/{id}/confirm` | Explicitly confirm actual traveller dates |
| `GET /api/v1/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD&reference_date=YYYY-MM-DD` | Daily per-person usage and explicit selected-plan baseline (up to 366 dates) |
| `GET /api/v1/eligibility/summary?reference_date=YYYY-MM-DD` | Separate allowance summaries; confirmed history only |
| `POST /api/v1/trips/preview` | Validate an unsaved itinerary and preview authoritative Schengen day counts without saving |
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
`search_days` (default 365). Saved plans never automatically consume allowance. When selected, their affected
later travel dates are also checked so an extra trip cannot silently invalidate them.
Full-itinerary searches preserve country segments, recheck membership on shifted
dates and reject conflicts with selected baseline travel. The maximum continuous
stay metric measures rule capacity; other booked destinations must also be checked.
See the [catalogue coverage and primary sources](country-catalogue.md).
