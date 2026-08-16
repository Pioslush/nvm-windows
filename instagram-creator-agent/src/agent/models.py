"""Pydantic schemas shared across the pipeline (also used as Claude structured-output formats)."""

from typing import List, Optional

from pydantic import BaseModel


class PlannedPost(BaseModel):
    day: str                # e.g. "Monday"
    date: str               # ISO date "2026-08-17"
    time: str               # local "HH:MM"
    pillar: str             # which content pillar this serves
    format: str             # "single_image" | "carousel" | "reel_cover"
    idea: str               # one-sentence post concept
    hook: str               # first line designed to stop the scroll


class ContentPlan(BaseModel):
    week_of: str
    strategy_note: str      # why this mix, in one paragraph
    posts: List[PlannedPost]


class PostDraft(BaseModel):
    caption: str
    hashtags: List[str]
    alt_text: str
    image_brief: str        # description for the photographer / image generator
    cta: str                # the call to action used in the caption


class QueueItem(BaseModel):
    id: str
    status: str             # "pending" | "approved" | "rejected" | "published"
    scheduled_for: str      # ISO datetime, local tz
    plan: PlannedPost
    draft: PostDraft
    image_url: Optional[str] = None          # single-image post
    image_urls: Optional[List[str]] = None   # 2-10 images -> published as a carousel
    video_url: Optional[str] = None          # hosted video -> published as a Reel
    video_path: Optional[str] = None         # local video file -> resumable-uploaded Reel
    ig_media_id: Optional[str] = None
    published_at: Optional[str] = None


class WeeklyReport(BaseModel):
    summary: str
    what_worked: List[str]
    what_to_change: List[str]
    monetization_suggestions: List[str]
    next_week_focus: str
