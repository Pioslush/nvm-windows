"""Generate a public image URL for each post so publishing needs no manual step.

Instagram's publishing API only accepts publicly hosted image URLs, so the
generator must produce a *hosted* image, not just bytes:

  - provider "pollinations": free text-to-image at image.pollinations.ai — the
    prompt itself forms a public URL, which we pre-fetch to force generation
    and verify before handing it to Instagram. No API key needed.
  - Optional: set IMGBB_API_KEY to re-host the generated image on imgbb for a
    stable, permanent URL (recommended for production).
  - provider "none": keep the original manual flow (paste URLs during review).
"""

import os
import random
import time
import urllib.parse

import requests

from .config import settings


class ImageError(RuntimeError):
    pass


def generate(brief: str) -> str:
    """Return a public URL for an image matching the brief."""
    cfg = settings.cfg.get("images", {})
    provider = cfg.get("provider", "pollinations")
    if provider == "none":
        raise ImageError("images.provider is 'none' — supply image URLs manually during review")
    if provider != "pollinations":
        raise ImageError(f"Unknown images.provider: {provider}")

    width = int(cfg.get("width", 1080))
    height = int(cfg.get("height", 1350))
    # Long prompts 404 on the provider (the URL path gets too long once
    # percent-encoded) — keep the raw prompt comfortably short.
    prompt = urllib.parse.quote(
        f"{brief[:280]}. Photorealistic, high quality, no text or watermarks."
    )
    seed = random.randint(0, 2**31)
    url = (
        f"https://image.pollinations.ai/prompt/{prompt}"
        f"?width={width}&height={height}&seed={seed}&nologo=true"
    )

    # Pre-fetch: forces generation server-side (cached afterwards) and verifies
    # the URL actually serves an image before Instagram tries to fetch it.
    # Generation can take a while and the endpoint is occasionally flaky, so retry.
    last_err = "unknown"
    for attempt in range(3):
        try:
            resp = requests.get(url, timeout=180)
            if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("image/"):
                break
            last_err = f"HTTP {resp.status_code}"
        except requests.RequestException as e:
            last_err = str(e)
        time.sleep(2 * (attempt + 1))
    else:
        raise ImageError(f"Image generation failed after 3 attempts ({last_err})")

    imgbb_key = os.getenv("IMGBB_API_KEY")
    if imgbb_key:
        return _rehost_imgbb(resp.content, imgbb_key)
    return url


def _rehost_imgbb(image_bytes: bytes, api_key: str) -> str:
    """Upload to imgbb for a stable permanent URL."""
    resp = requests.post(
        "https://api.imgbb.com/1/upload",
        data={"key": api_key},
        files={"image": ("post.jpg", image_bytes)},
        timeout=60,
    )
    data = resp.json()
    if not data.get("success"):
        raise ImageError(f"imgbb upload failed: {data}")
    return data["data"]["url"]
