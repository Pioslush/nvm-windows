"""Claude-powered content planning and caption writing."""

import json
from datetime import date

import anthropic

from .config import settings
from .models import ContentPlan, PlannedPost, PostDraft, WeeklyReport

client = anthropic.Anthropic(api_key=settings.anthropic_api_key or None)

SYSTEM = f"""You are the content strategist and copywriter for an Instagram creator account.

Niche: {settings.account['niche']}
Voice: {settings.account['voice']}
Audience: {settings.account['audience']}
Content pillars: {', '.join(settings.account['pillars'])}

Write captions that sound like a real person in this voice — specific, useful,
and honest. Never fabricate statistics, credentials, or personal experiences
presented as fact. Never write engagement-bait ("comment X to win"), medical or
individualized financial advice, or claims that guarantee outcomes. Sponsored
or affiliate content must be clearly labeled (#ad / "affiliate link")."""

AI_DISCLOSURE = "\n\n✍️ Drafted with AI assistance, reviewed by a human."


def make_weekly_plan(recent_performance: str | None = None) -> ContentPlan:
    """Generate a 7-day content calendar."""
    context = f"\n\nRecent performance data to learn from:\n{recent_performance}" if recent_performance else ""
    response = client.messages.parse(
        model=settings.model,
        max_tokens=16000,
        system=SYSTEM,
        messages=[{
            "role": "user",
            "content": (
                f"Plan the week starting {date.today().isoformat()}. "
                f"Create {settings.account['posts_per_week']} posts spread across the week, "
                f"rotating the content pillars. Each post gets a concrete idea and a scroll-stopping "
                f"hook (not clickbait). Times are local ({settings.posting['timezone']}); default to "
                f"{settings.posting['default_time']} unless a different time clearly fits the idea better."
                f"{context}"
            ),
        }],
        output_format=ContentPlan,
    )
    return response.parsed_output


def draft_post(plan: PlannedPost) -> PostDraft:
    """Write the caption, hashtags, alt text and image brief for one planned post."""
    response = client.messages.parse(
        model=settings.model,
        max_tokens=16000,
        system=SYSTEM,
        messages=[{
            "role": "user",
            "content": (
                "Write this planned post in full.\n\n"
                f"{plan.model_dump_json(indent=2)}\n\n"
                "Caption: 80-150 words, open with the hook, end with one clear CTA. "
                "Hashtags: 8-15, mixing broad and niche tags, no banned or spammy tags. "
                "Alt text: one factual sentence describing the image for screen readers. "
                "Image brief: enough detail that a designer or image model can produce it."
            ),
        }],
        output_format=PostDraft,
    )
    draft = response.parsed_output
    if settings.account.get("disclose_ai"):
        draft.caption += AI_DISCLOSURE
    return draft


def weekly_report(analytics: dict, revenue: dict) -> WeeklyReport:
    """Summarize performance and suggest next moves toward the revenue goal."""
    response = client.messages.parse(
        model=settings.model,
        max_tokens=16000,
        system=SYSTEM,
        messages=[{
            "role": "user",
            "content": (
                "Here is this account's recent post analytics and revenue log. "
                f"The monthly revenue goal is ${settings.monthly_goal:,.0f} across these streams: "
                f"{', '.join(settings.revenue_streams)}.\n\n"
                f"ANALYTICS:\n{json.dumps(analytics, indent=2)}\n\n"
                f"REVENUE:\n{json.dumps(revenue, indent=2)}\n\n"
                "Write the weekly report: what worked, what to change, and concrete monetization "
                "moves (specific brands/products/offers that fit this niche, realistic rates for "
                "this account's size). Be honest about the gap to goal — no hype."
            ),
        }],
        output_format=WeeklyReport,
    )
    return response.parsed_output
