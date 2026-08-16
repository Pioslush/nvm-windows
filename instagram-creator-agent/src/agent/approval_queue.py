"""File-backed draft queue with a human approval gate."""

import uuid
from datetime import datetime

from .config import QUEUE_DIR
from .models import PlannedPost, PostDraft, QueueItem


def _path(item_id: str):
    return QUEUE_DIR / f"{item_id}.json"


def add(plan: PlannedPost, draft: PostDraft, auto_approve: bool = False) -> QueueItem:
    item = QueueItem(
        id=uuid.uuid4().hex[:12],
        status="approved" if auto_approve else "pending",
        scheduled_for=f"{plan.date}T{plan.time}:00",
        plan=plan,
        draft=draft,
    )
    save(item)
    return item


def save(item: QueueItem) -> None:
    _path(item.id).write_text(item.model_dump_json(indent=2))


def load_all(status: str | None = None) -> list[QueueItem]:
    items = [QueueItem.model_validate_json(p.read_text()) for p in sorted(QUEUE_DIR.glob("*.json"))]
    if status:
        items = [i for i in items if i.status == status]
    return sorted(items, key=lambda i: i.scheduled_for)


def _has_media(item: QueueItem) -> bool:
    return bool(item.image_url or item.image_urls or item.video_url or item.video_path)


def due_for_publish() -> list[QueueItem]:
    now = datetime.now().isoformat()
    return [i for i in load_all("approved") if i.scheduled_for <= now and _has_media(i)]
