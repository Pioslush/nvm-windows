"""Publish posts and fetch insights via the official Instagram Graph API.

Content publishing is a two-step flow: create a media container from a public
image URL, then publish it. Docs:
https://developers.facebook.com/docs/instagram-platform/content-publishing

The API host depends on which login flavor the account uses (IG_GRAPH_HOST):
  - graph.instagram.com  — Instagram API with Instagram Login (default)
  - graph.facebook.com   — Instagram API with Facebook Login (page-linked)
"""

import os

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


def discover(token: str) -> dict:
    """Work out which login flavor a token belongs to and find the IG user ID.

    Tries the Instagram-Login flavor first (GET graph.instagram.com/me), then
    the Facebook-Login flavor (GET /me/accounts with each Page's linked
    instagram_business_account). Returns a dict describing what was found.
    """
    # Instagram Login flavor: the token IS the IG user's token
    try:
        me = _check(requests.get(
            "https://graph.instagram.com/v21.0/me",
            params={"fields": "user_id,username", "access_token": token},
            timeout=30,
        ))
        return {
            "flavor": "instagram_login",
            "host": "graph.instagram.com",
            "ig_user_id": me.get("user_id") or me.get("id"),
            "username": me.get("username"),
        }
    except InstagramError:
        pass

    # Facebook Login flavor: user token -> pages -> linked IG account
    pages = _check(requests.get(
        "https://graph.facebook.com/v21.0/me/accounts",
        params={
            "fields": "name,id,access_token,instagram_business_account{id,username}",
            "access_token": token,
        },
        timeout=30,
    ))
    found = []
    for page in pages.get("data", []):
        ig = page.get("instagram_business_account")
        if ig:
            found.append({
                "page_name": page["name"],
                "page_id": page["id"],
                "page_access_token": page.get("access_token"),
                "ig_user_id": ig["id"],
                "username": ig.get("username"),
            })
    return {"flavor": "facebook_login", "host": "graph.facebook.com", "linked_accounts": found}


def exchange_token(short_lived_token: str, app_secret: str) -> dict:
    """Exchange a short-lived IG user token (1h) for a long-lived one (60 days).

    GET https://graph.instagram.com/access_token
        ?grant_type=ig_exchange_token&client_secret=...&access_token=...

    Server-side only — never embed the app secret in client code.
    Returns {access_token, token_type, expires_in}.
    """
    return _check(requests.get(
        "https://graph.instagram.com/access_token",
        params={
            "grant_type": "ig_exchange_token",
            "client_secret": app_secret,
            "access_token": short_lived_token,
        },
        timeout=30,
    ))


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


def publish_carousel(image_urls: list[str], caption: str) -> str:
    """Publish a multi-image carousel (2-10 slides). Returns the IG media ID.

    Flow: one child container per image (is_carousel_item=true), then a
    CAROUSEL container referencing the children, then publish.
    """
    if not 2 <= len(image_urls) <= 10:
        raise InstagramError(f"Carousels need 2-10 images, got {len(image_urls)}")
    children = []
    for url in image_urls:
        child = _check(requests.post(
            f"{GRAPH}/{settings.ig_user_id}/media",
            data={
                "image_url": url,
                "is_carousel_item": "true",
                "access_token": settings.ig_access_token,
            },
            timeout=30,
        ))
        children.append(child["id"])
    container = _check(requests.post(
        f"{GRAPH}/{settings.ig_user_id}/media",
        data={
            "media_type": "CAROUSEL",
            "children": ",".join(children),
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


def _wait_for_container(container_id: str, timeout_s: int = 300) -> None:
    """Video containers process asynchronously — poll until FINISHED."""
    import time
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        status = _check(requests.get(
            f"{GRAPH}/{container_id}",
            params={"fields": "status_code", "access_token": settings.ig_access_token},
            timeout=30,
        )).get("status_code")
        if status == "FINISHED":
            return
        if status == "ERROR":
            raise InstagramError("Video container processing failed")
        time.sleep(5)
    raise InstagramError("Timed out waiting for video container to process")


def publish_reel(caption: str, video_url: str | None = None,
                 video_path: str | None = None) -> str:
    """Publish a Reel from a hosted video URL or a local file. Returns media ID.

    Hosted URL: container with media_type=REELS + video_url.
    Local file: container with upload_type=resumable, then binary upload to
    rupload.facebook.com (Authorization: OAuth <token>, offset/file_size headers).
    """
    if not (video_url or video_path):
        raise InstagramError("publish_reel needs video_url or video_path")
    params = {
        "media_type": "REELS",
        "caption": caption,
        "access_token": settings.ig_access_token,
    }
    if video_url:
        params["video_url"] = video_url
    else:
        params["upload_type"] = "resumable"
    container = _check(requests.post(
        f"{GRAPH}/{settings.ig_user_id}/media", data=params, timeout=30,
    ))
    if video_path:
        with open(video_path, "rb") as f:
            payload = f.read()
        upload = requests.post(
            f"https://rupload.facebook.com/ig-api-upload/v21.0/{container['id']}",
            headers={
                "Authorization": f"OAuth {settings.ig_access_token}",
                "offset": "0",
                "file_size": str(len(payload)),
            },
            data=payload,
            timeout=600,
        )
        if not upload.json().get("success"):
            raise InstagramError(f"Video upload failed: {upload.text[:200]}")
    _wait_for_container(container["id"])
    published = _check(requests.post(
        f"{GRAPH}/{settings.ig_user_id}/media_publish",
        data={"creation_id": container["id"], "access_token": settings.ig_access_token},
        timeout=30,
    ))
    return published["id"]


def publish_to_facebook_page(message: str, image_url: str | None = None) -> str:
    """Cross-post to a Facebook Page. Returns the created post/photo ID.

    With an image: POST /{page-id}/photos (url + caption) — a real photo post.
    Without:       POST /{page-id}/feed   (message only).
    Pages API always lives on graph.facebook.com, regardless of IG_GRAPH_HOST.
    """
    page_id = os.getenv("FB_PAGE_ID", "")
    page_token = os.getenv("FB_PAGE_TOKEN", "")
    if not (page_id and page_token):
        raise InstagramError("Cross-posting needs FB_PAGE_ID and FB_PAGE_TOKEN in .env")
    if image_url:
        data = _check(requests.post(
            f"https://graph.facebook.com/v21.0/{page_id}/photos",
            data={"url": image_url, "caption": message, "access_token": page_token},
            timeout=30,
        ))
    else:
        data = _check(requests.post(
            f"https://graph.facebook.com/v21.0/{page_id}/feed",
            data={"message": message, "access_token": page_token},
            timeout=30,
        ))
    return data.get("post_id") or data["id"]


def recent_media(limit: int = 10) -> list[dict]:
    """Most recent published media (id, caption, timestamp)."""
    data = _check(requests.get(
        f"{GRAPH}/{settings.ig_user_id}/media",
        params={
            "fields": "id,caption,timestamp,permalink",
            "limit": limit,
            "access_token": settings.ig_access_token,
        },
        timeout=30,
    ))
    return data.get("data", [])


def list_comments(media_id: str) -> list[dict]:
    """Top-level comments on a post (id, text, username, timestamp)."""
    data = _check(requests.get(
        f"{GRAPH}/{media_id}/comments",
        params={
            "fields": "id,text,username,timestamp",
            "access_token": settings.ig_access_token,
        },
        timeout=30,
    ))
    return data.get("data", [])


def reply_to_comment(comment_id: str, message: str) -> str:
    """Post a reply under a comment. Returns the reply's ID."""
    data = _check(requests.post(
        f"{GRAPH}/{comment_id}/replies",
        data={
            "message": message,
            "access_token": settings.ig_access_token,
        },
        timeout=30,
    ))
    return data["id"]


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
