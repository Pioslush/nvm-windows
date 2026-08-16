"""CLI entrypoint: plan | generate | review | publish | report | log-revenue."""

import argparse
import json
import sys
from datetime import datetime

from . import analytics, approval_queue, content_generator, image_generator, instagram_publisher, revenue
from .config import PLAN_FILE, settings
from .models import ContentPlan


def cmd_plan(_args) -> None:
    perf = analytics.latest()
    perf_str = json.dumps(perf) if perf.get("posts") else None
    plan = content_generator.make_weekly_plan(perf_str)
    PLAN_FILE.write_text(plan.model_dump_json(indent=2))
    print(f"Planned week of {plan.week_of}: {len(plan.posts)} posts")
    print(f"Strategy: {plan.strategy_note}\n")
    for p in plan.posts:
        print(f"  {p.day} {p.date} {p.time} [{p.pillar}/{p.format}] {p.idea}")


def cmd_generate(_args) -> None:
    if not PLAN_FILE.exists():
        sys.exit("No plan found — run `plan` first.")
    plan = ContentPlan.model_validate_json(PLAN_FILE.read_text())
    auto = settings.approval_mode == "auto"
    already = {(i.plan.date, i.plan.time) for i in approval_queue.load_all()}
    created = 0
    for planned in plan.posts:
        if (planned.date, planned.time) in already:
            continue
        draft = content_generator.draft_post(planned)
        item = approval_queue.add(planned, draft, auto_approve=auto)
        try:
            if "carousel" in planned.format.lower():
                slides = int(settings.cfg.get("images", {}).get("carousel_slides", 3))
                item.image_urls = [
                    image_generator.generate(draft.image_brief) for _ in range(slides)
                ]
                item.image_url = item.image_urls[0]
                label = f"+ {slides}-slide carousel"
            else:
                item.image_url = image_generator.generate(draft.image_brief)
                label = "+ image"
            approval_queue.save(item)
            print(f"Drafted {item.id} ({item.status}) {label}: {planned.idea}")
        except image_generator.ImageError as e:
            print(f"Drafted {item.id} ({item.status}), image FAILED ({e}): {planned.idea}")
        created += 1
    print(f"\n{created} draft(s) in queue. "
          + ("Auto-approval is ON — `publish` will send them when due."
             if auto else "Run `review` to approve them."))


def cmd_review(_args) -> None:
    pending = approval_queue.load_all("pending")
    if not pending:
        print("Nothing pending.")
        return
    for item in pending:
        print("\n" + "=" * 60)
        print(f"[{item.id}] scheduled {item.scheduled_for} | {item.plan.pillar}")
        print(f"\n{item.draft.caption}\n")
        print("Tags: " + " ".join(f"#{t.lstrip('#')}" for t in item.draft.hashtags))
        print(f"Image brief: {item.draft.image_brief}")
        print(f"Image: {item.image_url or '(none — will need one before publish)'}")
        choice = input(
            "\n[a]pprove / [r]eject / [g]enerate new image / [s]kip, optionally 'a <image_url>': "
        ).strip()
        if choice.startswith("g"):
            try:
                item.image_url = image_generator.generate(item.draft.image_brief)
                print(f"New image: {item.image_url}")
            except image_generator.ImageError as e:
                print(f"Image generation failed: {e}")
            choice = input("[a]pprove / [r]eject / [s]kip: ").strip()
        if choice.startswith("a"):
            item.status = "approved"
            parts = choice.split(maxsplit=1)
            if len(parts) == 2:
                item.image_url = parts[1]
        elif choice.startswith("r"):
            item.status = "rejected"
        approval_queue.save(item)
    print("\nReview done. Approved posts publish automatically when due.")


def cmd_publish(_args) -> None:
    due = approval_queue.due_for_publish()
    if not due:
        print("No approved posts due (or missing image_url).")
        return
    for item in due:
        caption = item.draft.caption + "\n\n" + " ".join(
            f"#{t.lstrip('#')}" for t in item.draft.hashtags
        )
        try:
            if item.video_url or item.video_path:
                media_id = instagram_publisher.publish_reel(
                    caption, video_url=item.video_url, video_path=item.video_path)
            elif item.image_urls and len(item.image_urls) >= 2:
                media_id = instagram_publisher.publish_carousel(item.image_urls, caption)
            else:
                media_id = instagram_publisher.publish_image(item.image_url, caption)
        except instagram_publisher.InstagramError as e:
            print(f"FAILED {item.id}: {e}")
            continue
        item.status = "published"
        item.ig_media_id = media_id
        item.published_at = datetime.now().isoformat()
        approval_queue.save(item)
        print(f"Published {item.id} -> media {media_id}")
        if settings.cfg.get("crosspost", {}).get("facebook_page"):
            try:
                fb_id = instagram_publisher.publish_to_facebook_page(caption, item.image_url)
                print(f"  cross-posted to Facebook Page -> {fb_id}")
            except instagram_publisher.InstagramError as e:
                print(f"  Facebook cross-post FAILED (IG post unaffected): {e}")
        if settings.cfg.get("crosspost", {}).get("threads"):
            try:
                th_id = instagram_publisher.publish_to_threads(
                    item.draft.caption, item.image_url)
                print(f"  cross-posted to Threads -> {th_id}")
            except instagram_publisher.InstagramError as e:
                print(f"  Threads cross-post FAILED (IG post unaffected): {e}")


def cmd_report(_args) -> None:
    data = analytics.refresh()
    rev = revenue.month_summary()
    print(f"Revenue {rev['month']}: ${rev['total']:,.2f} / ${rev['goal']:,.0f} "
          f"({rev['pct_of_goal']}% of goal, ${rev['gap']:,.2f} to go)")
    for src, amt in rev["by_source"].items():
        print(f"  {src}: ${amt:,.2f}")
    report = content_generator.weekly_report(data, rev)
    print(f"\n{report.summary}\n")
    print("What worked:")
    for w in report.what_worked:
        print(f"  + {w}")
    print("Change next:")
    for c in report.what_to_change:
        print(f"  ~ {c}")
    print("Monetization moves:")
    for m in report.monetization_suggestions:
        print(f"  $ {m}")
    print(f"\nNext week's focus: {report.next_week_focus}")


def cmd_engage(_args) -> None:
    """Fetch comments on recent posts, draft replies with Claude, approve, send."""
    replied_file = analytics.ANALYTICS_FILE.parent / "replied_comments.json"
    replied: set[str] = set(json.loads(replied_file.read_text())) if replied_file.exists() else set()
    auto = settings.approval_mode == "auto"
    my_username = settings.account.get("username", "")
    sent = 0
    for media in instagram_publisher.recent_media(limit=10):
        caption = media.get("caption", "")
        for comment in instagram_publisher.list_comments(media["id"]):
            if comment["id"] in replied or comment.get("username") == my_username:
                continue
            draft = content_generator.draft_reply(
                comment.get("text", ""), comment.get("username", ""), caption
            )
            if draft is None:
                replied.add(comment["id"])   # marked handled: spam / no reply needed
                continue
            print(f"\n@{comment.get('username')}: {comment.get('text')}")
            print(f"  draft reply: {draft}")
            if not auto:
                choice = input("  [s]end / [e]dit / [k]skip: ").strip()
                if choice.startswith("e"):
                    draft = input("  your reply: ").strip()
                elif not choice.startswith("s"):
                    continue
            instagram_publisher.reply_to_comment(comment["id"], draft)
            replied.add(comment["id"])
            sent += 1
    replied_file.write_text(json.dumps(sorted(replied)))
    print(f"\nSent {sent} repl{'y' if sent == 1 else 'ies'}.")


def cmd_whoami(_args) -> None:
    """Verify IG credentials resolve to the expected account."""
    try:
        info = instagram_publisher.account_info()
    except instagram_publisher.InstagramError as e:
        sys.exit(f"Credential check FAILED: {e}\n"
                 "Check IG_USER_ID / IG_ACCESS_TOKEN in .env and that IG_GRAPH_HOST matches the "
                 "token's login flavor (run `discover <token>` to detect it).\n"
                 "Required scopes — Instagram Login (graph.instagram.com): "
                 "instagram_business_basic + instagram_business_content_publish; "
                 "Facebook Login (graph.facebook.com): instagram_basic + instagram_content_publish.")
    expected = settings.account.get("username")
    print(f"Connected as @{info.get('username')} ({info.get('name', '')})")
    print(f"  followers: {info.get('followers_count')}  posts: {info.get('media_count')}")
    if expected and info.get("username") != expected:
        sys.exit(f"WARNING: token resolves to @{info.get('username')} but config.yaml "
                 f"expects @{expected} — you may be using the wrong account's credentials.")
    print("Credentials OK.")


def cmd_discover(args) -> None:
    """Given any access token, identify the login flavor, host, and IG user ID."""
    try:
        result = instagram_publisher.discover(args.token)
    except instagram_publisher.InstagramError as e:
        sys.exit(f"Discovery failed: {e}\n"
                 "The token may be expired — generate a fresh one and retry.")
    if result["flavor"] == "instagram_login":
        print("Instagram Login flavor detected. Put these in .env:")
        print(f"  IG_GRAPH_HOST={result['host']}")
        print(f"  IG_USER_ID={result['ig_user_id']}")
        print(f"  IG_ACCESS_TOKEN=<this token — run exchange-token first if it's short-lived>")
        print(f"Account: @{result.get('username')}")
        return
    print("Facebook Login flavor detected.")
    if not result["linked_accounts"]:
        sys.exit("No Pages with a linked Instagram professional account were found.\n"
                 "Link your Instagram account to a Facebook Page, or check the token's permissions "
                 "(pages_show_list + instagram_basic).")
    for acct in result["linked_accounts"]:
        print(f"\nPage: {acct['page_name']} ({acct['page_id']})")
        print(f"  linked IG account: @{acct.get('username')} — IG_USER_ID={acct['ig_user_id']}")
        print("  use the PAGE access token below as IG_ACCESS_TOKEN "
              "(exchange it for a long-lived one):")
        print(f"  {acct['page_access_token']}")
    print(f"\nAlso set IG_GRAPH_HOST={result['host']} in .env")


def cmd_exchange_token(args) -> None:
    """Swap a short-lived IG token (1h) for a long-lived one (60 days)."""
    import os
    secret = os.getenv("IG_APP_SECRET")
    if not secret:
        sys.exit("Set IG_APP_SECRET in .env (your Instagram app's secret from the App Dashboard). "
                 "Never put the secret in client-side code.")
    try:
        result = instagram_publisher.exchange_token(args.short_lived_token, secret)
    except instagram_publisher.InstagramError as e:
        sys.exit(f"Exchange failed: {e}")
    days = result.get("expires_in", 0) // 86400
    print("Long-lived token acquired — put this in .env as IG_ACCESS_TOKEN:\n")
    print(result["access_token"])
    print(f"\nExpires in ~{days} days. Re-run this command (or refresh) before it expires.")


def cmd_log_revenue(args) -> None:
    entry = revenue.log(args.amount, args.source, args.note or "")
    rev = revenue.month_summary()
    print(f"Logged ${entry['amount']:,.2f} from {entry['source']}. "
          f"Month total: ${rev['total']:,.2f} ({rev['pct_of_goal']}% of goal).")


def main() -> None:
    parser = argparse.ArgumentParser(prog="instagram-creator-agent")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("plan").set_defaults(fn=cmd_plan)
    sub.add_parser("generate").set_defaults(fn=cmd_generate)
    sub.add_parser("review").set_defaults(fn=cmd_review)
    sub.add_parser("publish").set_defaults(fn=cmd_publish)
    sub.add_parser("report").set_defaults(fn=cmd_report)
    sub.add_parser("whoami").set_defaults(fn=cmd_whoami)
    sub.add_parser("engage").set_defaults(fn=cmd_engage)
    p_disc = sub.add_parser("discover")
    p_disc.add_argument("token")
    p_disc.set_defaults(fn=cmd_discover)
    p_tok = sub.add_parser("exchange-token")
    p_tok.add_argument("short_lived_token")
    p_tok.set_defaults(fn=cmd_exchange_token)
    p_rev = sub.add_parser("log-revenue")
    p_rev.add_argument("amount", type=float)
    p_rev.add_argument("--source", required=True)
    p_rev.add_argument("--note")
    p_rev.set_defaults(fn=cmd_log_revenue)
    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
