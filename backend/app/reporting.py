"""Report definitions and bounded calendar handling, independent of a database."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import HTTPException

METRICS = ("leads", "calls", "meetings", "sales", "revenue_ore")
STAGES = ("new", "callback", "meeting", "sold", "declined")


def report_window(start: date, end: date, timezone_name: str):
    if end == date.max or end < start or (end - start).days >= 366:
        raise HTTPException(422, "Velg en periode på mellom 1 og 366 dager")
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Ukjent tidssone") from None
    # Local midnights, not fixed 24-hour increments: DST days may be 23/25 hours.
    return (datetime.combine(start, time.min, zone).astimezone(timezone.utc),
            datetime.combine(end + timedelta(days=1), time.min, zone).astimezone(timezone.utc))


def assemble_report(start: date, end: date, timezone_name: str, rows: list[dict],
                    pipeline: list[dict], cohort: dict, distributions: dict) -> dict:
    days = {start + timedelta(days=i): {key: 0 for key in METRICS}
            for i in range((end - start).days + 1)}
    for row in rows:
        day = row["day"]
        if day in days:
            for key in METRICS:
                days[day][key] += int(row.get(key, 0) or 0)
    totals = {key: sum(day[key] for day in days.values()) for key in METRICS}
    created, sold = int(cohort["leads"]), int(cohort["sold"])
    return {
        "period": {"start": start, "end": end, "timezone": timezone_name},
        "currency": "NOK", "totals": totals,
        "series": [{"date": day, **values} for day, values in days.items()],
        "pipeline": [{"stage": stage, "count": sum(int(r["count"]) for r in pipeline if r["stage"] == stage)} for stage in STAGES],
        "cohort": {"leads": created, "sold": sold, "conversion_percent": round(sold * 100 / created, 2) if created else None},
        "distributions": distributions,
    }


def distribution_summary(count: int, quantiles, unit: str):
    """Min/max whiskers, not Tukey fences. Suppress samples smaller than five."""
    if count < 5 or not quantiles:
        return {"count": count, "available": False, "unit": unit, "whisker_method": "min_max", "summary": None}
    return {"count": count, "available": True, "unit": unit, "whisker_method": "min_max",
            "summary": dict(zip(("min", "q1", "median", "q3", "max"), [float(x) for x in quantiles]))}
