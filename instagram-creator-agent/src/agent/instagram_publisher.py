"""Publish posts and fetch insights via the official Instagram Graph API.

Content publishing is a two-step flow: create a media container from a public
image URL, then publish it. Docs:
https://developers.facebook.com/docs/instagram-platform/content-publishing

The API host depends on which login flavor the account uses (IG_GRAPH_HOST):
  - graph.instagram.com  — Instagram API with Instagram Login (default)
  - graph.facebook.com   — Instagram API with Facebook Login (page-linked)
"""

import requests

from .config import settings

GRAPH = f"https://{settings.ig_graph_host}/v21.0"


class InstagramError(RuntimeError):
    pass


def _check(resp: requests.Response) -> dict:
    data = resp.json()
    if "error" in data:
        raise InstagramError(data["error"].get("message", str(data["error"])))
    return data


def account_info() -> dict:
    """Read the IG user node — verifies credentials and returns profile basics.

    GET /{ig-user-id}?fields=...&access_token=...
    """
    return _check(requests.get(
        f"{GRAPH}/{settings.ig_user_id}",
        params={
            "fields": "id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url",
            "access_token": settings.ig_access_token,
        },
        timeout=30,
    ))


def publish_image(image_url: str, caption: str) -> str:
    """Create a media container and publish it. Returns the IG media ID."""
    container = _check(requests.post(
        f"{GRAPH}/{settings.ig_user_id}/media",
        data={
            "image_url": image_url,
            "caption": caption,
            "access_token": settings.ig_access_token,
        },
        timeout=30,
    ))
    published = _check(requests.post(
        f"{GRAPH}/{settings.ig_user_id}/media_publish",
        data={
            "creation_id": container["id"],
            "access_token": settings.ig_access_token,
        },
        timeout=30,
    ))
    return published["id"]


def media_insights(media_id: str) -> dict:
    """Reach/likes/saves/comments/shares for one post."""
    data = _check(requests.get(
        f"{GRAPH}/{media_id}/insights",
        params={
            "metric": "reach,likes,saved,comments,shares",
            "access_token": settings.ig_access_token,
        },
        timeout=30,
    ))
    return {m["name"]: m["values"][0]["value"] for m in data.get("data", [])}


def account_insights() -> dict:
    """Account-level metrics over the last 30 days."""
    data = _check(requests.get(
        f"{GRAPH}/{settings.ig_user_id}/insights",
        params={
            "metric": "reach,accounts_engaged,follower_count",
            "period": "day",
            "metric_type": "total_value",
            "access_token": settings.ig_access_token,
        },
        timeout=30,
    ))
    return {m["name"]: m.get("total_value", {}).get("value") for m in data.get("data", [])}
