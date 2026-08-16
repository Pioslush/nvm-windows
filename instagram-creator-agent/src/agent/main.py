"""CLI entrypoint: plan | generate | review | publish | report | log-revenue."""

import argparse
import json
import sys
from datetime import datetime

from . import analytics, approval_queue, content_generator, instagram_publisher, revenue
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
        created += 1
        print(f"Drafted {item.id} ({item.status}): {planned.idea}")
    print(f"\n{created} draft(s) in queue. "
          + ("Auto-approval is ON — set image URLs, then `publish`."
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
        choice = input("\n[a]pprove / [r]eject / [s]kip, optionally 'a <image_url>': ").strip()
        if choice.startswith("a"):
            item.status = "approved"
            parts = choice.split(maxsplit=1)
            if len(parts) == 2:
                item.image_url = parts[1]
        elif choice.startswith("r"):
            item.status = "rejected"
        approval_queue.save(item)
    print("\nReview done. Approved posts need an image_url before publishing "
          "(edit the queue JSON or pass it during approval).")


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
            media_id = instagram_publisher.publish_image(item.image_url, caption)
        except instagram_publisher.InstagramError as e:
            print(f"FAILED {item.id}: {e}")
            continue
        item.status = "published"
        item.ig_media_id = media_id
        item.published_at = datetime.now().isoformat()
        approval_queue.save(item)
        print(f"Published {item.id} -> media {media_id}")


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


def cmd_whoami(_args) -> None:
    """Verify IG credentials resolve to the expected account."""
    try:
        info = instagram_publisher.account_info()
    except instagram_publisher.InstagramError as e:
        sys.exit(f"Credential check FAILED: {e}\n"
                 "Check IG_USER_ID / IG_ACCESS_TOKEN in .env (token must be long-lived "
                 "with instagram_basic + instagram_content_publish permissions).")
    expected = settings.account.get("username")
    print(f"Connected as @{info.get('username')} ({info.get('name', '')})")
    print(f"  followers: {info.get('followers_count')}  posts: {info.get('media_count')}")
    if expected and info.get("username") != expected:
        sys.exit(f"WARNING: token resolves to @{info.get('username')} but config.yaml "
                 f"expects @{expected} — you may be using the wrong account's credentials.")
    print("Credentials OK.")


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
    p_rev = sub.add_parser("log-revenue")
    p_rev.add_argument("amount", type=float)
    p_rev.add_argument("--source", required=True)
    p_rev.add_argument("--note")
    p_rev.set_defaults(fn=cmd_log_revenue)
    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
