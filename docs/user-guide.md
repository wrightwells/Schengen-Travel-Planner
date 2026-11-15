# User guide

Return to the [product overview and installation](../README.md).

## Application screens

The responsive dark interface uses Home, History, Planner and More. Mobile has a
safe-area-aware bottom navigation; desktop has a sidebar. Home shows authoritative
confirmed-history allowance rings, history-review status and upcoming trips.
Traveller selection persists in this browser and never combines allowances.

History contains confirmed journeys and filters. Planner has Trips, Calendar and
Timeline views, saved-plan assessments and explicit scenario inclusion. Shared
itineraries show their dates once with both travellers identified. Forms open in
focused dialogs with numbered steps, server-counted Schengen days and independent
eligibility results. More contains profile editing, history review, and import/export.
Calendar date details open in keyboard-accessible sheets. Timeline dragging checks
provisional eligibility and opens adjusted country segments for review before saving.
Browser-local scenario storage is unchanged. See the [UI design specification](ui-design-spec.md).

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

## Calendar

The Travel calendar provides month, year and Gantt views, Monday-first weeks, separate
traveller indicators, inclusive range selection and daily trip details. Confirmed
history always appears. **Include in scenario** on each saved plan controls whether
that plan appears on the calendar and counts towards allowance calculations.
Multiple included plans appear together. Excluded plans are hidden. The scenario
selection and displayed month are remembered in this browser. Opening, cancelling
or saving an edit preserves the scenario selection. The editor excludes its own
saved copy from assessment without changing that selection.

Use the visible **Month view**, **Year view** and **Timeline view** buttons to switch layouts.
In Gantt view, drag a trip’s left or right handle to change its entry or exit date.
The bar previews the dates and eligibility while dragging. Releasing opens the
adjusted shared itinerary for review; Save applies the change. Escape or a
cancelled touch leaves it unchanged. Focus a handle and use Left/Right to change one day. Drag near the
edge of the timeline to scroll. Shared itineraries resize together; travellers
with separate itineraries keep their own dates. Shortening trims country segments;
extending continues the first or last destination. Conflicts and stale edits are
rejected with the original bar restored. Editing history clears its completeness
review. Finish or cancel an open trip editor before using the handles. For trips
crossing a year boundary, navigate to the year containing the endpoint to resize it.

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
assessment status. Red counts show over-limit dates, green indicates capacity to add a Schengen day while keeping later selected travel
within the allowance, and unknown/unassessed profiles never receive green availability. Day
counts deduplicate country transition dates. With no plans included, the calendar
shows history only and explains how to include a plan.

Tap a start date and an end date, then **Plan selected dates** to populate the
itinerary editor for the visible travellers. Destinations still need review before
a plan can be assessed or saved. Day details show extra consecutive Schengen days that can be added before the next
booking while keeping later selected travel within the allowance. The rolling
unused-day count describes only the window ending on the inspected date; it does
not reserve capacity for future plans. The API also retains the separate
`maximum_contiguous_stay_days` rule-capacity metric; the calendar uses
`maximum_additional_stay_days`, which checks affected booked days up to 179 days
after the extra stay, including travel outside the visible month or year.

The authenticated calendar API accepts repeated `included_plan_ids` parameters,
rejects stale plan IDs and conflicting selected itineraries, and returns up to 366
dates per request. Browser-local today is sent as `reference_date` so server
timezone does not shift future availability.

## Export travel

In **More**, use **Export travel** to choose history CSV, history calendar
(.ics), or planned-trip calendar (.ics). Select either traveller or both using the current
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

See [export formats, identity policy and API](exports.md).

## Import travel history

In **More**, use **Import travel history** below exports. Choose a UTF-8 history CSV in the
schema shown in [export/import formats](exports.md), then **Preview import**.
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
