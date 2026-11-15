# Schengen Travel Planner
## UX/UI Design Specification — Option 3: Dark Mode

**Document version:** 1.0\
**Design approach:** Mobile-first, responsive, dark-mode application\
**Target platforms:** Android, iOS, mobile browser, tablet and desktop\
**Implementation:** Suitable for React, Vue, Flutter or another component-based UI framework

---

# 1. Design Objectives

The application must provide an elegant, modern interface that makes Schengen travel allowances easy to understand and future trips straightforward to plan.

The design must prioritise:

1. **Immediate visibility:** Users should see how many Schengen days they have used and how many remain without navigating.
2. **Traveller separation:** Each traveller has independent travel records and allowance calculations, even when sharing journeys.
3. **Simple trip planning:** Planning a trip should require minimal interaction, with automatic calculation of eligibility.
4. **Visual clarity:** Information should be presented through progress indicators, compact cards, calendars and clearly differentiated statuses.
5. **Mobile usability:** All primary activities must be comfortably performed using one hand on a smartphone.
6. **Functional consistency:** The desktop and mobile versions must share the same data, business logic and calculation results.

The existing website's long, vertically arranged sections must be reorganised into separate application screens.

# 2. Visual Identity

## 2.1 Overall Appearance

The design uses a premium dark interface with subtle purple accents.

It must resemble a modern financial or travel management application rather than a traditional administrative website.

Visual characteristics:

- Deep charcoal or near-black backgrounds.
- Slightly lighter cards with rounded corners.
- Purple accent colours for selected states and primary actions.
- Large, easily readable numerical values.
- Minimal borders and separators.
- Consistent typography and spacing.
- Subtle shadows, gradients and animations.
- Clear differentiation between confirmed travel, proposed travel and allowance warnings.

Dark mode is the default appearance.

## 2.2 Colour Palette

Use the following design tokens.

| Token | Hex value | Usage |
|---|---|---|
| Background primary | `#101116` | Application background |
| Background secondary | `#191B25` | Navigation and secondary panels |
| Card background | `#242633` | Primary cards |
| Card elevated | `#2D3040` | Active/selected cards |
| Purple primary | `#9B5CFF` | Primary buttons and selected states |
| Purple light | `#BD91FF` | Highlights and progress indicators |
| Purple dark | `#6035B8` | Gradient endpoints |
| Text primary | `#F7F7FA` | Titles and important numbers |
| Text secondary | `#A6A8B8` | Descriptions and supplementary text |
| Success | `#43C98B` | Eligible travel |
| Warning | `#FFBD59` | Approaching allowance |
| Danger | `#FF6978` | Allowance exceeded |
| Border | `#393C4D` | Card boundaries and dividers |

The purpose of colour is to communicate information, not simply decoration.

Warning and error states must always include text or an icon so they remain understandable to users with colour-vision deficiencies.

## 2.3 Typography

Use **Inter** as the preferred application font.

Fallback stack:

`Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

| Element | Font size | Weight |
|---|---|---|
| Main page title | 24px | 700 |
| Section title | 20px | 650 |
| Card title | 17px | 600 |
| Primary allowance number | 36px | 700 |
| Secondary allowance number | 30px | 700 |
| Normal content | 14–16px | 400 |
| Small supporting text | 12–13px | 400 |
| Button text | 15px | 600 |
| Navigation labels | 11–12px | 500 |

Use tabular numerals for dates, day counts and numeric allowance displays to prevent distracting shifts as values change.

Text must never be smaller than 12px in normal application content.

## 2.4 Spacing, Corners and Elevation

Use a consistent 4px spacing scale.

| Element | Specification |
|---|---|
| Mobile screen padding | 16px |
| Card internal padding | 16px |
| Gap between cards | 12px |
| Section spacing | 24px |
| Small element gap | 8px |
| Card corner radius | 18px |
| Button corner radius | 12px |
| Input corner radius | 12px |
| Traveller selector radius | 14px |
| Bottom navigation height | Approximately 72px plus safe area |

Cards should use very subtle borders.

Shadows should be restrained because heavy shadows are generally ineffective against very dark backgrounds.

Selected cards may use a slight purple glow, provided text contrast is maintained.

# 3. Application Navigation

## 3.1 Mobile Navigation

The mobile application uses a permanently available bottom navigation bar with four destinations:

| Tab | Icon | Function |
|---|---|---|
| Home | House | Dashboard and allowance summary |
| History | Calendar/history | Confirmed travel records |
| Planner | Calendar-days | Future trips, scenarios and calendar |
| More | Ellipsis | Travellers, import/export and settings |

The bottom navigation must:

- Remain visible when scrolling ordinary screen content.
- Respect Android and iOS safe-area insets.
- Highlight the selected tab in purple.
- Display both an icon and text label.
- Use touch targets of at least 44×44px, preferably 48×48px.
- Avoid covering content, including form buttons or the last list item.

Full-screen editing dialogs may temporarily replace the bottom navigation with Back, Cancel and Save controls.

## 3.2 Desktop Navigation

On desktop layouts, replace the bottom navigation with a left sidebar.

The sidebar contains the same four primary destinations, with expandable sub-navigation for planner views.

The principal application content should have a comfortable maximum width of approximately 1,440px.

On desktop, traveller allowance cards can display side by side.

# 4. Home Dashboard

The Home screen must be the default landing screen after authentication.

Its function is to answer three questions immediately:

- How many Schengen days have I used?
- How many days do I currently have remaining?
- What is my next trip, and can I make it?

## 4.1 Application Header

At the top of the screen, display:

- Stylised Schengen 'S' logo on the left.
- Product name: **Schengen Travel Planner**.
- Optional compact account or notification icon on the right.

The header should fit within approximately 60–68px excluding safe-area padding.

Avoid decorative imagery that pushes the allowance information below the first screen.

## 4.2 Household Summary

Directly below the header, display a compact household card.

Example:

**Household**\
Two travellers · Individual allowances

The card has a right-facing chevron and opens the traveller management screen.

On a small mobile screen, this card may be omitted from the Home screen after onboarding if the traveller selector makes household management readily accessible.

## 4.3 Traveller Selector

Display a segmented control containing the two existing traveller profiles.

Example:

`[ Rich ]   [ Coz ]`

The selected traveller appears on a purple filled background.

The inactive traveller remains dark grey.

Interaction rules:

- A single tap changes the selected traveller.
- The allowance summary, travel history and upcoming journey information update immediately.
- No full-page reload occurs.
- The selected traveller persists during normal application navigation.
- Each traveller's allowance calculations remain entirely independent.

A combined household view may be available from the traveller selector, but must not combine day counts into a fictitious household allowance.

## 4.4 Allowance Card

This is the most prominent component in the entire application.

It should occupy approximately 230–290px vertically, depending on content and text scaling.

### Card Content

Header:

**Rich**\
Standard 90/180 rule

Primary visual:

Circular progress ring showing the number of Schengen days used in the current rolling 180-day window.

Centre of ring:

**53 / 90**\
days used

To the right of the ring:

**37**\
Remaining days

Footer:

As of 05 Nov 2026 · Confirmed history only

The displayed values are representative of the existing website snapshot, not hard-coded constants.

### Circular Progress Indicator

The ring should:

- Use an SVG or equivalent vector component.
- Be approximately 112–128px in diameter.
- Use a stroke width of 10–12px.
- Have a muted grey background track.
- Display a purple progress arc.
- Animate smoothly when the selected traveller changes.
- Cap the visual ring at 100%, even when the calculated count exceeds 90.

The actual numeric value must never be capped.

The ring's filled proportion is:

`min(days_used / 90, 1)`

### Allowance States

| State | Condition | Presentation |
|---|---|---|
| Normal | Fewer than 75 days used | Purple progress indicator |
| Caution | 75–89 days used | Amber progress indicator |
| At limit | Exactly 90 days used | Amber/red warning |
| Over limit | More than 90 days used | Red error state |
| Unassessed | History incomplete or calculation unavailable | Neutral/unknown state |

These thresholds are **UX presentation defaults**, not Schengen legal rules.

The application must not assume that a positive remaining-day count guarantees eligibility for a proposed multi-day trip.

## 4.5 History Verification

Immediately beneath the allowance card, show a compact verification panel.

When complete:

- Green check icon.
- **History reviewed**
- Supporting text: "Recheck completeness whenever you add or correct a trip."

When incomplete:

- Amber warning icon.
- **History needs review**
- Supporting text explaining that allowance results may be incomplete.

Tapping the panel opens the history review action.

History completeness must remain specific to each traveller.

## 4.6 Upcoming Trips

Show a compact list of the next planned trips for the selected traveller.

Each item displays:

- Trip name.
- Country or countries.
- Start and end dates.
- Total Schengen days for that trip.
- Scenario inclusion status.
- Eligibility summary where assessed.

Example:

**Spring 27**\
France · 26 Feb – 11 Apr 2027\
45 Schengen days · Included in scenario

Trip entries should open a detail screen on tap.

When no trips exist, display an empty-state message and a prominent **Plan a trip** action.

## 4.7 Quick Action

Provide a prominent floating or fixed action:

**+ Plan trip**

The action should be easily accessible without scrolling back to the top.

It must not overlap navigation, form fields or important content.

# 5. Travel History Screen

The History screen displays confirmed historical journeys.

History must never be mixed with provisional plans without clearly distinguishing their statuses.

## 5.1 Screen Layout

Header:

**Travel History**

Subtitle:

Confirmed journeys. Entry and exit dates both count.

Top-right action:

**+ Add**

Immediately below, show:

- Traveller filter: Rich, Coz, Both.
- Country filter.
- Year filter.
- Optional date-range filter.

On smaller phones, secondary filters may be displayed in a collapsible filter drawer.

## 5.2 Journey Cards

Replace the existing large website journey blocks with compact mobile cards.

Each card should display:

**Aug–Sep 26**\
France\
06 Aug – 20 Sep 2026\
**46 Schengen days**

Also display small traveller avatar chips for everyone participating in the journey.

The card should not duplicate the same dates and country text for every traveller when the itinerary is shared and identical.

Where travellers have different dates or destinations, the differences must remain visible.

## 5.3 Journey Interaction

Tapping a card opens the journey detail screen.

The detail screen provides:

- Full date range.
- Country segments.
- Traveller participants.
- Schengen day breakdown.
- Confirmed status.
- Edit action.
- Delete action with confirmation.

A swipe action may expose Edit, but it must not be the only way to edit a journey.

Deletion must always require confirmation.

## 5.4 Adding Historical Travel

Provide a step-based form:

**Step 1 — Travellers**

Select Rich, Coz or both.

**Step 2 — Dates**

Select arrival and departure dates.

**Step 3 — Countries**

Choose countries and any intermediate travel segments.

**Step 4 — Review**

Show the counted Schengen days and confirm the history record.

The underlying application must count both entry and exit dates and avoid double-counting overlapping Schengen segments for an individual traveller.

After saving, all affected allowance indicators must update immediately.

# 6. Future Travel Planner

The Planner is the principal interactive function of the application.

It must allow the user to test a journey before committing it to their scenario.

## 6.1 Planner Screen Structure

The screen contains three internal views:

**Trips | Calendar | Timeline**

Use a segmented selector at the top.

The selected subview persists when navigating away and returning.

The planner must have a permanent or readily accessible **+ Plan trip** action.

## 6.2 Trips View

Display saved future plans in chronological order.

Each trip card contains:

- Trip name.
- Destinations.
- Departure date.
- Return date.
- Traveller avatars.
- Total Schengen days.
- Provisional status.
- Scenario inclusion state.
- Eligibility result for each traveller.

Cards must be significantly more compact than those on the current website.

### Trip Actions

Tapping the card opens detailed information and a menu with:

- Edit.
- Duplicate.
- Include/exclude from scenario.
- Confirm as history.
- Delete.

Confirmation as history must require an explicit user action.

Changing scenario inclusion must trigger a recalculation without converting the plan into confirmed travel.

## 6.3 Create Trip Workflow

Use a mobile-friendly wizard or progressive form.

### Stage 1 — Travellers

Present two selectable avatar chips.

Both travellers can be selected.

### Stage 2 — Travel Dates

Use a modern date-range picker.

The user selects:

1. Entry date.
2. Exit date.

The selected interval is inclusive.

Display the total number of calendar days immediately.

### Stage 3 — Destination

Allow selection of:

- Schengen countries.
- United Kingdom.
- Other non-Schengen countries.

Support multiple country segments within the same journey.

The destination selector must distinguish Schengen and non-Schengen travel.

### Stage 4 — Eligibility Calculation

Show separate assessments for each traveller.

Example:

**Rich — Eligible**\
**Coz — Eligible**

Alternatively, show the precise date or dates that would exceed the allowance.

The calculation must evaluate each day of the itinerary against the applicable rolling 180-day window and selected scenario.

It must include all relevant confirmed travel plus plans included in the current scenario.

### Stage 5 — Save

Allow the user to:

- Save as provisional.
- Include the plan in the active scenario.
- Return to editing.

New plans are excluded from scenarios by default, matching the existing website behaviour.

Do not silently include a newly created plan in the active scenario.

# 7. Travel Calendar

The calendar should make it possible to understand historic travel, future plans and remaining capacity without interpreting complex tables.

## 7.1 Calendar Views

Provide:

- Month view.
- Year overview.
- Timeline view.

On mobile, month view is the default.

On desktop and larger tablets, the timeline may be the default for advanced planning.

## 7.2 Month Calendar

Show a conventional seven-column calendar with Monday as the first day.

Use the following visual states:

| Day type | Appearance |
|---|---|
| Confirmed Schengen history | Solid purple background |
| Included future plan | Light purple background |
| Non-Schengen travel | Muted blue/grey marker |
| Additional day available | Small green indicator |
| No extra travel capacity | Amber indicator |
| Allowance exceeded | Red background or marker |
| Unknown/unassessed | Neutral hatched or outlined style |
| Today | Thin bright outline |

The current website distinguishes confirmed travel, planned travel, over-limit dates, additional capacity, no capacity and unknown dates. These distinctions must be preserved.

Where multiple states overlap, apply a documented visual priority and provide a day-detail explanation rather than hiding an underlying status.

## 7.3 Day Detail

Tapping a date opens a bottom sheet.

Display:

- Selected date.
- Traveller.
- Days used in the preceding 180-day rolling window.
- Remaining numerical allowance.
- Recorded or planned travel that day.
- Whether another Schengen day can safely be added without invalidating later selected plans.
- Relevant warning, if any.

When both travellers are selected, display separate results.

## 7.4 Selecting a Date Range

Interaction:

1. First tap selects the start date.
2. Second tap selects the end date.
3. Selected dates receive continuous purple highlighting.
4. A third tap begins a new selection.

After selecting the interval, display:

**Plan selected dates**

Selecting this action opens the trip creation workflow with the dates prefilled.

Calendar selection and calculation must use the relevant civil dates rather than relying on elapsed 24-hour intervals, avoiding daylight-saving time errors.

# 8. Timeline / Gantt View

The current horizontal Gantt chart offers advanced functionality that should be retained.

However, its desktop-style density is unsuitable for direct use on a narrow phone.

## 8.1 Mobile Timeline

Display:

- Horizontal date axis.
- One row per selected traveller.
- Travel blocks spanning their dates.
- Compact rolling-count information.
- Sticky traveller labels.

The visible time range should adapt to screen width.

Users can scroll horizontally through future and historical dates.

## 8.2 Timeline Editing

Support dragging trip start and end handles on touch devices.

While dragging:

- Show the proposed new date in a tooltip.
- Highlight the changed duration.
- Recalculate eligibility provisionally.
- Provide visible feedback if the proposed dates create an allowance issue.

Do not save every intermediate drag position.

Save on release only after validating the final proposed change.

Provide an alternative date editor for users who cannot or prefer not to drag.

## 8.3 Shared Itinerary Behaviour

Where a trip is shared, moving or resizing the shared itinerary affects the selected shared journey according to the existing application model.

Any action that changes multiple travellers' records must clearly communicate that effect.

Country-segment adjustments must follow the existing itinerary rules and be visible for review before final confirmation.

# 9. Traveller Management

The Traveller Management screen is accessed from More or the household card.

Display one compact profile card per traveller.

Each profile contains:

- Avatar with initials.
- Display name.
- Applicable allowance rule.
- Current days used.
- Remaining days.
- History verification status.

Allow the display name to be edited.

Provide controls to mark history complete or incomplete.

The two travellers must remain separate data entities even when their journeys overlap completely.

# 10. Import and Export

Move administrative functions from the main dashboard into:

**More → Data Management**

## Import

Support the existing UTF-8 CSV history schema.

Workflow:

1. Select file.
2. Preview rows.
3. Map imported traveller names to profiles.
4. Validate dates, countries and duplicate/overlapping entries.
5. Review the proposed import.
6. Confirm.

Do not import invalid records silently.

## Export

Provide the existing formats:

- Confirmed travel history CSV.
- History calendar export (.ics).
- Planned travel calendar export (.ics).

Allow selection of one or both travellers.

Use the platform's native share/download mechanism where available.

Do not suggest that planned journeys have been confirmed merely because they have been exported.

# 11. Feedback and Interaction Design

## 11.1 Button Hierarchy

**Primary buttons**

Purple filled background, white text.

Use for Plan Trip, Save, Confirm and other principal actions.

**Secondary buttons**

Dark elevated background with light text.

Use for Edit, Duplicate, Filters and navigation actions.

**Destructive buttons**

Red text or red filled button, depending on context.

Use only for Delete or irreversible actions.

## 11.2 Form Controls

All forms must:

- Have persistent text labels.
- Use appropriate mobile keyboard types.
- Support platform date pickers where appropriate.
- Show clear validation immediately after interaction.
- Preserve user-entered values if validation fails.
- Avoid requiring users to repeatedly enter unchanged information.

Date fields must support an unambiguous day/month/year presentation for UK users, with international ISO-format storage.

## 11.3 Bottom Sheets

Use mobile bottom sheets for:

- Date detail.
- Trip action menu.
- Filter selection.
- Lightweight confirmations.
- Traveller selection where appropriate.

Use full-screen forms for multi-stage or complex editing.

Sheets must support touch, keyboard and assistive technologies.

## 11.4 Animation

Use restrained animation:

- Traveller switching: approximately 180–240ms.
- Card appearance: approximately 150–200ms.
- Progress ring transition: approximately 250–350ms.
- Bottom-sheet transitions: approximately 200–300ms.

Animations must respect reduced-motion accessibility preferences.

Avoid decorative motion that interferes with reading allowance values.

# 12. Responsive Behaviour

| Viewport | Layout |
|---|---|
| Under 600px | Single-column mobile layout with bottom navigation |
| 600–899px | Expanded cards and tablet-friendly content |
| 900–1199px | Sidebar navigation with multi-column cards |
| 1200px and above | Full desktop layout with calendar/timeline workspace |

These are suggested initial breakpoints and may be refined after device testing.

On wide screens:

- Show both traveller allowance cards side by side.
- Allow trips and calendar details to appear in adjacent panels.
- Display richer timeline information.
- Preserve the same actions and terminology used on mobile.

Avoid changing the underlying workflow solely because the user changes device orientation or browser width.

# 13. Accessibility

The interface must target **WCAG 2.2 AA**.

Specific requirements:

- Normal text contrast of at least 4.5:1.
- Large text contrast of at least 3:1.
- Visible keyboard focus indicators.
- Logical focus order.
- Accessible labels for all icon-only buttons.
- Screen-reader descriptions for progress rings.
- Minimum 24×24px accessible pointer targets, with 44–48px preferred for mobile controls.
- Support for browser text enlargement and device font scaling.
- No colour-only communication of eligibility.
- Date controls operable without dragging.
- Reduced-motion support.
- Form errors announced and linked to their fields.

Progress indicators must provide numeric equivalent text.

For example, a screen reader should announce:

"Rich. 53 Schengen days used out of 90. 37 days numerically remaining, based on confirmed travel as of 5 November 2026."

# 14. Calculation and Data Presentation Rules

The redesigned interface must not alter the underlying Schengen compliance logic.

## 14.1 Rolling Window

For the standard 90/180-day rule:

- Evaluate each date using the 180-day period ending on that date.
- Include both entry and exit dates.
- Count applicable Schengen days once per traveller.
- Keep non-Schengen travel outside the Schengen-day total.
- Calculate each traveller independently.

## 14.2 Confirmed Versus Planned Data

The Home dashboard's primary allowance must clearly identify whether its figures represent confirmed history only or an active simulation.

Planned travel must not be silently treated as historical fact.

## 14.3 Scenario Safety

A positive remaining-day balance on a particular date is not necessarily permission to add a new day if it would conflict with included future plans.

The UI must distinguish:

- Numerical days remaining in the current rolling window.
- Eligibility for a specific proposed itinerary.
- Availability to add further travel while preserving the selected scenario.

These values are related but not interchangeable.

## 14.4 Incomplete History

When history is incomplete:

- Show the status prominently.
- Describe calculations as provisional or unassessed where appropriate.
- Do not display misleading green availability indicators.
- Allow the user to review and correct travel history.

## 14.5 Calculation Source

Frontend components should consume authoritative results from the existing calculation engine or a shared verified calculation library.

Do not independently implement different Schengen allowance calculations in individual UI components.

# 15. Suggested Component Architecture

The application should be constructed from reusable components.

```text
AppShell
├── AppHeader
├── DesktopSidebar
├── MobileBottomNavigation
├── TravellerSelector
├── HomeScreen
│   ├── AllowanceCard
│   │   ├── CircularProgress
│   │   ├── AllowanceNumbers
│   │   └── HistoryStatus
│   ├── UpcomingTrips
│   └── QuickPlanAction
├── HistoryScreen
│   ├── HistoryFilters
│   ├── JourneyCard
│   └── JourneyEditor
├── PlannerScreen
│   ├── PlannerTabs
│   ├── PlannedTripCard
│   ├── TripWizard
│   ├── TravelCalendar
│   ├── DayDetailSheet
│   └── TravelTimeline
├── TravellerManagement
├── DataManagement
│   ├── CSVImport
│   ├── CSVExport
│   └── CalendarExport
└── Shared
    ├── Button
    ├── Card
    ├── Avatar
    ├── StatusIndicator
    ├── DateRangePicker
    ├── BottomSheet
    ├── ConfirmationDialog
    └── EmptyState
```

All reusable components must use shared design tokens for colours, typography, spacing, borders and responsive behaviour.

# 16. Loading, Errors and Persistence

## Loading

When data is loading, show skeleton cards matching the intended content dimensions.

Do not display zero allowance or zero travel days as a placeholder while waiting for data.

## Errors

If calculation data cannot be retrieved:

- Display an explicit unavailable state.
- Retain previously loaded values only if clearly marked as cached.
- Provide Retry.
- Never interpret a failed calculation as eligible travel.

## Saving

After a successful save:

- Show a short confirmation.
- Refresh affected calculations.
- Update calendar and trip views.
- Preserve the user's current position where practical.

If saving fails, keep unsaved form data intact and allow another attempt.

## Persistence

Traveller selection, calendar view preferences and scenario inclusion must remain consistent with the application's intended persistence model.

For scenario selection, the existing website stores inclusion choices in the browser. A future implementation should explicitly decide whether to keep that per-device behaviour or migrate it to server-side household preferences.

This is a product decision and must not change silently.

# 17. Screen-Level Acceptance Criteria

## Home

- A traveller's allowance is visible without scrolling on a typical phone.
- Switching traveller updates all traveller-specific data.
- Confirmed history and simulated results are not confused.
- A new trip can be started directly.

## History

- Shared journeys show participating travellers clearly.
- Dates and day counts match the authoritative calculation.
- Editing a journey updates relevant allowances.
- Deletion requires confirmation.
- Filters are usable on narrow screens.

## Planner

- A trip can be created from start to save without using a desktop layout.
- Traveller eligibility is evaluated independently.
- Scenario inclusion is explicit.
- Invalid scenarios are clearly explained.
- A provisional trip can be edited, duplicated or confirmed.

## Calendar

- Historical and planned travel remain visually distinct.
- A date reveals its individual rolling-day calculation.
- Date-range selection works by touch.
- Availability does not misrepresent future scenario constraints.

## Timeline

- The view can be scrolled on mobile.
- Trip endpoints can be adjusted.
- A non-drag editing alternative exists.
- Shared-trip changes are clearly indicated.

## Accessibility

- All major journeys work with keyboard and screen reader.
- Content remains usable with enlarged text.
- Eligibility is understandable without relying on colour.

# 18. Development Priorities

Implement the redesign in the following order:

**Phase 1 — Design System and Application Shell**

Build colour tokens, typography, cards, buttons, navigation, traveller selection and responsive layouts.
