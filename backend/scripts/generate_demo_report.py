"""Deterministic, explicitly fictional chart fixture. Run from repository root."""
import json
from datetime import date, timedelta
from pathlib import Path
from app.reporting import assemble_report, distribution_summary

end = date(2026, 10, 31)
start = end - timedelta(days=29)
rows = [{"day": start + timedelta(days=i), "leads": 8 + i % 7, "calls": 12 + i % 11,
         "meetings": 1 + i % 3, "sales": i % 4, "revenue_ore": (i % 4) * 1490000} for i in range(30)]
report = assemble_report(start, end, "Europe/Oslo", rows,
    [{"stage": stage, "count": count} for stage, count in [("new", 86), ("callback", 24), ("meeting", 18), ("sold", 42), ("declined", 23)]],
    {"leads": sum(row["leads"] for row in rows), "sold": 31},
    {"sale_amount": distribution_summary(sum(row["sales"] for row in rows), [990000, 1190000, 1490000, 1990000, 3490000], "ore"),
     "hours_to_sale": distribution_summary(sum(row["sales"] for row in rows), [2, 18, 46, 92, 220], "hours")})
Path("frontend/src/lib/demo-report.json").write_text(json.dumps(report, default=str, indent=2) + "\n")
