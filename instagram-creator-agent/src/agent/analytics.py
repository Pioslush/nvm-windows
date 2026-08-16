"""Collect and persist post + account insights."""

import json
from datetime import datetime

from . import approval_queue, instagram_publisher
from .config import ANALYTICS_FILE


def _load() -> dict:
    if ANALYTICS_FILE.exists():
        return json.loads(ANALYTICS_FILE.read_text())
    return {"posts": {}, "account": {}}


def refresh() -> dict:
    """Pull latest insights for every published post plus account-level metrics."""
    data = _load()
    for item in approval_queue.load_all("published"):
        if item.ig_media_id:
            try:
                data["posts"][item.ig_media_id] = {
                    "published_at": item.published_at,
                    "pillar": item.plan.pillar,
                    "idea": item.plan.idea,
                    "metrics": instagram_publisher.media_insights(item.ig_media_id),
                }
            except instagram_publisher.InstagramError as e:
                data["posts"].setdefault(item.ig_media_id, {})["error"] = str(e)
    try:
        data["account"] = {
            "fetched_at": datetime.now().isoformat(),
            "metrics": instagram_publisher.account_insights(),
        }
    except instagram_publisher.InstagramError as e:
        data["account"] = {"error": str(e)}
    ANALYTICS_FILE.write_text(json.dumps(data, indent=2))
    return data


def latest() -> dict:
    return _load()
