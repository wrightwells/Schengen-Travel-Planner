"""Pure date-only 90/180 calculations, independent of HTTP and storage.

The caller resolves country membership and selects baseline plans before calling
this module. Presence sets are per traveller; household totals are never valid.
"""

from bisect import bisect_left, bisect_right
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from enum import StrEnum

RULE_VERSION = "90-180-v1"
DAY = timedelta(days=1)


class Status(StrEnum):
    PERMITTED = "PERMITTED"
    APPROACHING_LIMIT = "APPROACHING_LIMIT"
    OVER_LIMIT = "OVER_LIMIT"
    UNKNOWN = "UNKNOWN"
    NOT_ASSESSED = "NOT_ASSESSED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


def dates_between(start: date, end: date) -> frozenset[date]:
    if end < start:
        raise ValueError("Exit date must be on or after entry date")
    return frozenset(start + timedelta(days=i) for i in range((end - start).days + 1))


class PresenceIndex:
    """Sorted unique ordinals give bounded-memory rolling queries for sparse history."""

    def __init__(self, presence: Iterable[date]):
        self.days = sorted({day.toordinal() for day in presence})

    def used(self, day: date) -> int:
        ordinal = day.toordinal()
        return bisect_right(self.days, ordinal) - bisect_left(self.days, ordinal - 179)


@dataclass(frozen=True)
class Assessment:
    status: Status
    first_breach_date: date | None
    peak_rolling_days: int
    remaining_at_entry: int
    remaining_at_exit: int
    maximum_contiguous_stay_days: int | None
    maximum_stay_horizon_reached: bool
    earliest_one_day_entry: date | None
    earliest_full_trip_entry: date | None
    search_end_date: date
    excess_days: int
    warnings: tuple[str, ...]
    rule_version: str = RULE_VERSION


def _legal_overlay(baseline: PresenceIndex, candidate: Iterable[date]) -> bool:
    """Only new presence counts: overlapping source records never count twice."""
    candidate_ordinals = sorted({day.toordinal() for day in candidate})
    existing = set(baseline.days)
    new = [day for day in candidate_ordinals if day not in existing]
    for ordinal in candidate_ordinals:
        used = baseline.used(date.fromordinal(ordinal))
        used += bisect_right(new, ordinal) - bisect_left(new, ordinal - 179)
        if used > 90:
            return False
    return True


def evaluate(
    baseline: Iterable[date],
    candidate: Iterable[date],
    *,
    entry: date,
    exit: date,
    rule_applicable: bool | None,
    history_complete: bool,
    search_days: int = 365,
    warning_threshold: int = 80,
    candidate_at: Callable[[date], Iterable[date] | None] | None = None,
    one_day_available: Callable[[date], bool] | None = None,
) -> Assessment:
    """Assess each candidate Schengen date and search complete shifted itineraries.

    ``candidate`` contains Schengen dates only; entry/exit may include neutral
    destinations. Search includes ``search_days`` possible entry dates. A shifted
    itinerary must also finish within the reported horizon. Search values are
    withheld when history or applicability is unknown, never implying permission.
    Remaining-at-entry includes that day's candidate presence.
    """
    if exit < entry:
        raise ValueError("Exit date must be on or after entry date")
    if not 1 <= search_days <= 3660:
        raise ValueError("Search horizon must be between 1 and 3660 days")
    if not 1 <= warning_threshold <= 90:
        raise ValueError("Warning threshold must be between 1 and 90")
    proposed = frozenset(candidate)
    if any(day < entry or day > exit for day in proposed):
        raise ValueError("Candidate presence must lie within the participant dates")
    baseline_days = frozenset(baseline)
    combined = PresenceIndex(baseline_days | proposed)
    usage = [(day, combined.used(day)) for day in sorted(proposed)]
    first_breach = next((day for day, used in usage if used > 90), None)
    peak = max((used for _, used in usage), default=0)
    warnings: list[str] = []

    if rule_applicable is False:
        status = Status.NOT_ASSESSED
        warnings.append("Not assessed — check immigration status")
    elif rule_applicable is None or not history_complete:
        status = Status.UNKNOWN
        warnings.append("Confirm rule applicability and history completeness before assessment")
    elif not proposed:
        status = Status.NOT_APPLICABLE
    elif first_breach:
        status = Status.OVER_LIMIT
        warnings.append("Proposed stay exceeds the rolling allowance")
    elif peak >= warning_threshold or 90 - peak < 10:
        status = Status.APPROACHING_LIMIT
        warnings.append("Approaching limit; the selected stay remains within 90 days")
    else:
        status = Status.PERMITTED

    search_end = entry + timedelta(days=search_days - 1)
    earliest_one = earliest_full = None
    maximum = None
    horizon_reached = False
    if rule_applicable is True and history_complete:
        index = PresenceIndex(baseline_days)
        maximum = 0
        uninterrupted: set[date] = set()
        # At most 91 consecutive days need examination: 91 always breaches.
        for offset in range(min(search_days, 91)):
            day = entry + timedelta(days=offset)
            uninterrupted.add(day)
            if not _legal_overlay(index, uninterrupted):
                break
            maximum += 1
        else:
            horizon_reached = maximum == search_days
        offsets = [(day - entry).days for day in proposed]
        duration = (exit - entry).days
        for offset in range(search_days):
            start = entry + timedelta(days=offset)
            if (
                earliest_one is None
                and (one_day_available is None or one_day_available(start))
                and _legal_overlay(index, [start])
            ):
                earliest_one = start
            if earliest_full is None and offset + duration < search_days:
                shifted = (
                    candidate_at(start)
                    if candidate_at
                    else (start + timedelta(days=day_offset) for day_offset in offsets)
                )
                if shifted is not None and _legal_overlay(index, shifted):
                    earliest_full = start
            if earliest_one is not None and earliest_full is not None:
                break
        if earliest_full is None:
            warnings.append("No complete permitted itinerary found within the search horizon")

    return Assessment(
        status=status,
        first_breach_date=first_breach,
        peak_rolling_days=peak,
        remaining_at_entry=max(0, 90 - combined.used(entry)),
        remaining_at_exit=max(0, 90 - combined.used(exit)),
        maximum_contiguous_stay_days=maximum,
        maximum_stay_horizon_reached=horizon_reached,
        earliest_one_day_entry=earliest_one,
        earliest_full_trip_entry=earliest_full,
        search_end_date=search_end,
        excess_days=max(0, peak - 90),
        warnings=tuple(warnings),
    )
