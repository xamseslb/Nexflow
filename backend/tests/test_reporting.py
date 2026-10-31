from datetime import date, timedelta
import pytest
from fastapi import HTTPException
from app.reporting import assemble_report, distribution_summary, report_window


@pytest.mark.parametrize("day,hours", [(date(2026, 3, 29), 23), (date(2026, 10, 25), 25)])
def test_oslo_calendar_day_respects_daylight_saving(day, hours):
    start, end = report_window(day, day, "Europe/Oslo")
    assert (end - start).total_seconds() == hours * 3600


@pytest.mark.parametrize("start,end,zone", [
    (date(2026, 2, 1), date(2026, 1, 1), "UTC"),
    (date(2026, 1, 1), date(2027, 1, 2), "UTC"),
    (date(2026, 1, 1), date(2026, 1, 2), "not-a-zone"),
])
def test_invalid_report_windows_are_rejected(start, end, zone):
    with pytest.raises(HTTPException) as error:
        report_window(start, end, zone)
    assert error.value.status_code == 422


def test_daily_totals_merge_independent_queries_and_fill_empty_days():
    start = date(2026, 10, 1)
    result = assemble_report(start, start + timedelta(days=2), "Europe/Oslo",
        [{"day": start, "leads": 10}, {"day": start, "sales": 2, "revenue_ore": 2990001},
         {"day": start + timedelta(days=2), "calls": 4}],
        [{"stage": "new", "count": 8}], {"leads": 10, "sold": 2}, {})
    assert result["totals"] == {"leads": 10, "calls": 4, "meetings": 0, "sales": 2, "revenue_ore": 2990001}
    assert result["series"][1] == {"date": start + timedelta(days=1), "leads": 0, "calls": 0, "meetings": 0, "sales": 0, "revenue_ore": 0}
    assert result["cohort"]["conversion_percent"] == 20.0
    assert len(result["pipeline"]) == 5
    assert result["pipeline"][3] == {"stage": "sold", "count": 0}


def test_empty_cohort_has_no_invented_conversion():
    day = date(2026, 1, 1)
    result = assemble_report(day, day, "UTC", [], [], {"leads": 0, "sold": 0}, {})
    assert result["cohort"]["conversion_percent"] is None
    assert result["totals"]["revenue_ore"] == 0


def test_small_samples_are_not_presented_as_reliable_boxplots():
    assert distribution_summary(4, [1, 2, 3, 4, 5], "ore")["summary"] is None
    result = distribution_summary(5, [1, 2, 3, 4, 5], "ore")
    assert result["summary"] == {"min": 1, "q1": 2, "median": 3, "q3": 4, "max": 5}
    assert result["whisker_method"] == "min_max"


def test_report_endpoint_is_manager_only():
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from uuid import uuid4
    from app.workspace import report
    db = MagicMock()
    db.info = {"user_id": uuid4()}
    db.get.return_value = SimpleNamespace(active=True, role="seller")
    with pytest.raises(HTTPException) as error:
        report(uuid4(), timezone="Europe/Oslo", db=db)
    assert error.value.status_code == 403
    db.execute.assert_not_called()
