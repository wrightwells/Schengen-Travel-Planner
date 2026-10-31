import random
from datetime import date, timedelta

import pytest

from app.services.eligibility import PresenceIndex, Status, dates_between, evaluate

DAY = timedelta(days=1)
START = date(2026, 1, 1)


def assess(candidate, baseline=(), **kwargs):
    return evaluate(
        baseline,
        candidate,
        entry=kwargs.pop("entry", min(candidate) if candidate else START),
        exit=kwargs.pop("exit", max(candidate) if candidate else START),
        rule_applicable=kwargs.pop("rule_applicable", True),
        history_complete=kwargs.pop("history_complete", True),
        **kwargs,
    )


def test_inclusive_90_and_91_days():
    allowed = assess(dates_between(START, START + 89 * DAY))
    assert allowed.status == Status.APPROACHING_LIMIT
    assert allowed.first_breach_date is None
    assert allowed.maximum_contiguous_stay_days == 90
    denied = assess(dates_between(START, START + 90 * DAY))
    assert denied.status == Status.OVER_LIMIT
    assert denied.first_breach_date == START + 90 * DAY
    assert denied.excess_days == 1


def test_window_drops_day_exactly_after_180_days():
    index = PresenceIndex([START])
    assert index.used(START + 179 * DAY) == 1
    assert index.used(START + 180 * DAY) == 0


def test_duplicate_presence_and_cross_border_day_count_once():
    candidate = list(dates_between(START, START + 89 * DAY)) * 2
    result = assess(candidate, baseline=candidate)
    assert result.peak_rolling_days == 90
    assert result.first_breach_date is None


def test_entry_can_pass_while_later_day_breaches():
    baseline = dates_between(START, START + 88 * DAY)
    result = assess([START + 100 * DAY, START + 101 * DAY], baseline)
    assert result.first_breach_date == START + 101 * DAY
    assert result.remaining_at_entry == 0


def test_independent_travellers_have_different_results():
    candidate = dates_between(START + 100 * DAY, START + 109 * DAY)
    assert assess(candidate).status == Status.PERMITTED
    assert assess(candidate, dates_between(START, START + 89 * DAY)).status == Status.OVER_LIMIT


@pytest.mark.parametrize(
    "applicable,complete,status",
    [
        (None, True, Status.UNKNOWN),
        (True, False, Status.UNKNOWN),
        (False, True, Status.NOT_ASSESSED),
    ],
)
def test_unconfirmed_profiles_never_claim_permission(applicable, complete, status):
    result = assess([START], rule_applicable=applicable, history_complete=complete)
    assert result.status == status
    assert result.earliest_one_day_entry is None
    assert result.maximum_contiguous_stay_days is None


def test_non_schengen_itinerary_is_not_applicable():
    assert assess([]).status == Status.NOT_APPLICABLE


def test_leap_day_year_end_and_non_schengen_gap():
    assert len(dates_between(date(2028, 2, 28), date(2028, 3, 1))) == 3
    assert len(dates_between(date(2026, 12, 31), date(2027, 1, 1))) == 2
    result = assess([START, START + 2 * DAY])
    assert result.peak_rolling_days == 2


def test_one_day_entry_can_precede_entry_for_full_duration():
    baseline = dates_between(START, START + 88 * DAY)
    result = assess([START + 100 * DAY, START + 101 * DAY], baseline)
    assert result.earliest_one_day_entry == START + 100 * DAY
    assert result.earliest_full_trip_entry == START + 179 * DAY


def test_shifted_search_preserves_neutral_day_offsets():
    baseline = dates_between(START, START + 89 * DAY)
    result = assess(
        [START + 179 * DAY],
        baseline,
        entry=START + 178 * DAY,
        exit=START + 180 * DAY,
    )
    assert result.earliest_full_trip_entry == START + 179 * DAY
    assert result.earliest_one_day_entry == START + 180 * DAY


def test_search_horizon_and_maximum_truncation_are_explicit():
    result = assess([START], search_days=10)
    assert result.maximum_contiguous_stay_days == 10
    assert result.maximum_stay_horizon_reached
    assert result.search_end_date == START + 9 * DAY
    unavailable = assess(
        [START + 100 * DAY], dates_between(START, START + 89 * DAY), search_days=10
    )
    assert unavailable.earliest_one_day_entry is None
    assert unavailable.earliest_full_trip_entry is None


def test_future_baseline_presence_is_not_counted_early():
    assert assess([START], [START + DAY]).peak_rolling_days == 1


def test_index_matches_simple_reference_for_random_presence():
    rng = random.Random(80180)
    for _ in range(100):
        presence = {START + rng.randrange(-400, 400) * DAY for _ in range(300)}
        index = PresenceIndex(presence)
        for offset in range(-100, 200, 7):
            day = START + offset * DAY
            assert index.used(day) == sum(day - 179 * DAY <= x <= day for x in presence)


def test_invalid_dates_and_thresholds_are_rejected():
    with pytest.raises(ValueError):
        dates_between(START + DAY, START)
    with pytest.raises(ValueError):
        assess([START], warning_threshold=91)
    with pytest.raises(ValueError):
        assess([START], entry=START + DAY)
