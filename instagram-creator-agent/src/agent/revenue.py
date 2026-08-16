"""Track logged income against the monthly goal."""

import json
from datetime import datetime

from .config import REVENUE_FILE, settings


def _load() -> list[dict]:
    if REVENUE_FILE.exists():
        return json.loads(REVENUE_FILE.read_text())
    return []


def log(amount: float, source: str, note: str = "") -> dict:
    entries = _load()
    entry = {
        "date": datetime.now().date().isoformat(),
        "amount": amount,
        "source": source,
        "note": note,
    }
    entries.append(entry)
    REVENUE_FILE.write_text(json.dumps(entries, indent=2))
    return entry


def month_summary(month: str | None = None) -> dict:
    """month: 'YYYY-MM', defaults to current month."""
    month = month or datetime.now().strftime("%Y-%m")
    entries = [e for e in _load() if e["date"].startswith(month)]
    total = sum(e["amount"] for e in entries)
    by_source: dict[str, float] = {}
    for e in entries:
        by_source[e["source"]] = by_source.get(e["source"], 0) + e["amount"]
    return {
        "month": month,
        "total": total,
        "goal": settings.monthly_goal,
        "gap": settings.monthly_goal - total,
        "pct_of_goal": round(100 * total / settings.monthly_goal, 1) if settings.monthly_goal else 0,
        "by_source": by_source,
        "entries": entries,
    }
