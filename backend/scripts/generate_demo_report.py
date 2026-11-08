"""Deterministic, explicitly fictional chart fixture. Run from repository root."""
import json
from random import Random
from datetime import date, timedelta
from pathlib import Path
from app.reporting import assemble_report, distribution_summary

end = date(2026, 10, 31)
start = end - timedelta(days=29)
rng = Random(20261031)
rows = [{"day": start + timedelta(days=i), "leads": 0, "calls": 0, "meetings": 0, "sales": 0}
        for i in range(30)]
# Spread fictional events over the month, with lighter weekend activity.
weights = [(0.10 if row["day"].weekday() >= 5 else 1) * rng.uniform(0.55, 1.4) for row in rows]
for metric, count in [("leads", 325), ("calls", 498), ("meetings", 60), ("sales", 43)]:
    for index in rng.choices(range(len(rows)), weights=weights, k=count):
        rows[index][metric] += 1
amounts = [9900] * 10 + [11900] * 10 + [14900] * 10 + [19900] * 12 + [34900]
rng.shuffle(amounts)
for row in rows:
    row["revenue_ore"] = 100 * sum(amounts.pop() for _ in range(row["sales"]))

report = assemble_report(start, end, "Europe/Oslo", rows,
    [{"stage": stage, "count": count} for stage, count in [("new", 86), ("callback", 24), ("meeting", 18), ("sold", 42), ("declined", 23)]],
    {"leads": sum(row["leads"] for row in rows), "sold": 31},
    {"sale_amount": distribution_summary(sum(row["sales"] for row in rows), [990000, 1190000, 1490000, 1990000, 3490000], "ore"),
     "hours_to_sale": distribution_summary(sum(row["sales"] for row in rows), [2, 18, 46, 92, 220], "hours")})
Path("frontend/src/lib/demo-report.json").write_text(json.dumps(report, default=str, indent=2) + "\n")
