# Schengen Travel Planner — Functional Specification

**Version:** 1.0  
**Date:** 28 October 2026  
**Status:** Implementation baseline  
**Audience:** Product owner, UX designer, developer, QA

## 1. Purpose
Build a responsive, touch-friendly, self-hosted web application for a UK household to record Schengen travel and plan proposed trips against the standard **90 days in any rolling 180-day period** rule. Two named travellers have independent records and calculations; they can participate in the same trip or travel separately.

The application is a planning aid, not an immigration decision or legal determination. Visa, nationality, residence status and bilateral exceptions may alter entitlement and must be surfaced prominently.

## 2. Scope and assumptions
- Exactly two named travellers in version 1, with editable display names and independently stored travel data.
- A single household login; no public registration or per-traveller accounts.
- Historical confirmed trips and future provisional trips, plus a read-only 365-day planning horizon starting from the chosen reference date (default today).
- Preloaded, maintained country catalogue identifying Schengen membership **by effective date**, including the UK and other non-Schengen destinations.
- CSV import/export of history; separate iCalendar (.ics) exports for history and planned travel.
- Private access through a Tailscale sidecar; no public Internet exposure by default.
- Primary UI in English, ISO calendar dates and configurable first day of week (Monday default).

## 3. Terminology
**Schengen day:** A calendar date counted as presence in the Schengen Area. **Rolling window:** The assessment date plus the preceding 179 calendar dates. **Confirmed history:** Travel that occurred, entered by the user and editable. **Planned trip:** Tentative future travel, not automatically counted as history. **Baseline:** Confirmed history plus any saved planned trips selected for a scenario. **Scenario:** A proposed entry and exit date assessed against the baseline. **Combined view:** Side-by-side or overlaid information for both travellers, without combining their allowances.

## 4. Users and journeys
The household user can (1) record past travel for one or both travellers; (2) inspect used and remaining days on any date; (3) choose future travel dates, destination countries and participating travellers; (4) see if the entire proposed stay is permitted; (5) discover the next permissible entry and maximum legal stay; (6) save a plan; (7) import/export data; and (8) use the application comfortably on a phone or desktop.

## 5. Functional requirements

### FR-01 — Household account and profiles
- One private authenticated household account manages two traveller profiles.
- Each profile stores ID, display name, optional notes, and a declaration of whether the standard short-stay calculation is applicable. Do not require passport details.
- Users may rename travellers without altering trip ownership or history.
- All dates, calculations, calendars, exports and alerts remain traveller-specific.
- If a traveller is not subject to the standard rule, show **Not assessed — check immigration status**, rather than a false green result.

### FR-02 — Country catalogue
- Preload Schengen states and common non-Schengen destinations, including the UK, using an updateable reference catalogue.
- Country selection supports search, typeahead and touch-friendly selection.
- A trip may contain one or more country segments with inclusive start/end dates. Crossing between Schengen states does not reset the clock.
- Determine Schengen status based on the **date of travel**, not solely current membership. Historical accessions and rule changes must be representable.
- An optional **Add country** control adds a destination from the catalogue to the itinerary, not a new arbitrary sovereign country. Administrators can update reference data separately.
- Non-Schengen days are visible in itineraries but do not consume Schengen allowance under the standard rule.

### FR-03 — Confirmed travel history (upper dashboard section)
- Show a top **Travel History** panel with both travellers, historical trip rows, destination(s), inclusive entry/exit dates, Schengen day totals, status and edit/delete controls.
- Filter by traveller, country, year and date range; sort newest first.
- Create a single trip shared by both travellers or a trip belonging to one person; allow distinct dates for each participant.
- Reject impossible date ranges, duplicate segments and contradictory overlapping locations for the same person; show clear corrective messages.
- Allow correction of past records with an audit trail of edits.
- Support manual creation and confirmation of trips and optional conversion of a planned trip to history after travel, requiring confirmation of actual dates.

### FR-04 — Future planning (lower dashboard section)
- Show a lower **Plan Future Travel** panel covering the next 365 calendar dates by default.
- Users select traveller(s), inclusive departure/entry and exit dates, destination country or multi-country itinerary, and a scenario name.
- A shared plan can contain different entry and exit dates for each traveller.
- Recalculate immediately on date, traveller or country changes, without saving the scenario.
- Display legal/over-limit status for each traveller, first date of breach, peak rolling-window usage, days remaining at entry and at exit, and maximum uninterrupted stay possible from the proposed entry date.
- Show earliest legal **entry for the requested duration**, and separately earliest day when **at least one day** of Schengen travel is available. If no date exists within the search horizon, state this explicitly.
- Offer **Save plan**, **Edit plan**, **Duplicate plan**, **Delete plan** and **Confirm as history**.
- A plan's inclusion in other scenario calculations is user-selectable; clearly label included/excluded plans to avoid hidden double counting.

### FR-05 — Compliance calculation and warnings
- Count **both entry and exit dates** as Schengen presence.
- For every date of a proposed Schengen stay, count unique Schengen presence dates in that date's inclusive 180-day rolling window. Allow no more than 90 days.
- Consecutive stays and multiple entries are treated identically; travel between Schengen countries does not reset the allowance.
- Never count overlapping segments or duplicate records twice for the same traveller and calendar date.
- Red **Over limit** status if any evaluated date exceeds 90; include first violating date and excess days.
- Amber **Approaching limit** status at a configurable threshold (default 80/90) and when the proposed itinerary leaves fewer than 10 days, without claiming that amber is unlawful.
- Green **Permitted in selected scenario** only when every proposed Schengen date is compliant and the rule is applicable.
- Display **Unknown / incomplete data** if a required historical interval is not established; avoid an unconditional compliant claim.
- Recompute when history, plans, participation, dates or country status changes.

### FR-06 — Full-page calendar
- Provide a full-page calendar showing months and days, navigable by month and year, with a 12-month overview and a detailed single-month mode.
- Traveller selector: Traveller A, Traveller B, Both. The combined view displays each person's status separately (e.g. split cells or labelled indicators).
- Required semantic colour palette: **blue** = confirmed historical Schengen presence; **purple** = saved/proposed future Schengen presence; **red** = day causing or lying in a non-compliant proposed stay; **green** = unbooked future entry day for which at least one Schengen day is currently permissible under the selected baseline.
- Non-Schengen trips have a distinct neutral treatment and clear labels.
- In a conflict, red overrides purple; history remains identifiable even when a historical breach is flagged.
- A green day is **not** a promise that an arbitrary-length trip is permitted; show permitted duration on selection.
- Include visible legend, tooltips/details, numeric usage, accessible text/icons/patterns and non-colour indicators.
- Tap/click a date to inspect rolling usage, remaining allowance, traveller, associated trips and candidate itinerary actions.
- Dragging to select a date range is optional on desktop; tap-start/tap-end is mandatory on mobile.

### FR-07 — Summary and dashboard
- Show per-traveller used days in the current rolling window, remaining days, next saved trip, and scenario status.
- History occupies the upper section and future planning the lower section; on narrow screens these stack vertically.
- Explain the reference date and the selected scenario/baseline beside every allowance metric.
- No single household-wide remaining-days value is displayed.

### FR-08 — Import and export
- **CSV history export** per traveller or both, UTF-8 with headers, ISO 8601 dates, documented schema and version.
- **CSV history import** supports preview, traveller mapping, date validation, duplicate detection, conflict reporting, transactional commit and rollback on failure.
- CSV import must not silently overwrite existing history; user explicitly selects skip or replace per conflict.
- **iCalendar history export** and **separate iCalendar future-plan export**, selectable by traveller or both, using `.ics` files.
- Each calendar event includes a stable UID, descriptive summary, country, traveller, status, and all-day inclusive dates represented as RFC 5545 exclusive `DTEND`.
- iCalendar export is one-way in v1; it is not a calendar sync or source of truth.
- Download names include export type and date. Provide an export preview and do not include secrets.

### FR-09 — Responsive and accessible interaction
- Support mobile widths from 320 px, tablet and desktop; no horizontal scrolling for primary workflows.
- Touch targets at least approximately 44×44 CSS px, readable typography, keyboard navigation and screen-reader labels.
- Date controls use mobile-friendly picker plus editable ISO/localised input where appropriate.
- Keep key totals and warnings visible while editing a plan; support reduced motion and WCAG 2.2 AA-oriented contrast and semantics.
- Confirm destructive actions and provide undo where feasible.

### FR-10 — Security, privacy and resilience
- Require household authentication even when connected through Tailscale; use secure sessions and logout.
- Private deployment, no trackers or analytics by default, no external cloud requirement for core operation.
- Provide database backup/restore instructions and visible backup/export functionality.
- Retain edits in an audit log with timestamps; no traveller identity document data required.
- Show application version, rule explanation, last catalogue update and disclaimer.

## 6. Screen inventory
1. **Dashboard:** header, per-traveller allowance summary, upper history panel, lower future planning panel, alert strip.
2. **Full Calendar:** 12-month and month views, traveller filter, scenario selector, legend and date details.
3. **Trip Editor:** shared/individual traveller participation, distinct dates, country segments, validation and save.
4. **Import/Export:** CSV import preview/commit, history CSV export, history ICS export and future ICS export.
5. **Settings:** profile names, account password, threshold, week start, backup/restore and catalogue/rule metadata.

## 7. Calculation examples and acceptance criteria
- A continuous Schengen stay of 90 inclusive days is allowed with no earlier presence; the 91st consecutive day is not.
- If both travellers share an itinerary but only one has earlier travel, their compliance statuses may differ.
- Two Schengen-country segments on the same date consume **one** day, not two.
- A trip leaving on 1 June and entering again on 2 June is two counted days, not one.
- A non-Schengen day does not consume allowance; surrounding Schengen days do.
- An itinerary with compliant entry but non-compliant later days is rejected as **over limit**, with the first violating day identified.
- A green unbooked calendar date shows the maximum possible stay and is not described as unconditional permission.
- CSV import with invalid or ambiguous dates never partially commits.
- An all-day iCalendar trip ending 10 May exports `DTEND;VALUE=DATE:YYYY0511` (exclusive end date), with the correct year.
- Both travellers' records and statuses remain distinct in combined calendar and exports.
- Core tasks work by touch on a 320 px viewport without requiring hover or desktop-only gestures.

## 8. Non-functional acceptance targets
- Typical calendar and scenario recalculation completes in under 500 ms at the API for two travellers and up to 2,000 travel records, on a modest local server (performance target to validate).
- Responsive layout, modern evergreen browsers and current mobile Safari/Chrome.
- Application survives container restart without loss of committed data; restores successfully from a documented backup.
- No unauthenticated API data access; no Internet-facing ports required.

## 9. Explicit exclusions from version 1
Automated passport scanning, ETIAS/EES integration, visa/residence-permit legal modelling, automatic travel detection, native mobile apps, multiple household accounts, live calendar sync, automatic border-rule legal updates and immigration advice.

## 10. Open design decisions delegated to technical specification
Frontend and API framework, database, session implementation, schema migration tool, Tailscale sidecar implementation, CSV schema version, background reference-data maintenance and test framework.

## 11. Release definition
Release 1 is complete when both travellers can maintain independent historical trips, simulate and save shared/individual future itineraries, inspect correct rolling-window warnings on a responsive colour-coded calendar, import/export CSV history, export separate history/plans `.ics`, and deploy privately through Docker Compose with a Tailscale sidecar.
