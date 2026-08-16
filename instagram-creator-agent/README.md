# Instagram Creator Agent

A Claude-powered system that runs the content pipeline for an Instagram creator
account: it plans a content calendar, writes captions and hashtags, schedules
and publishes posts through the **official Instagram Graph API**, tracks
performance, and monitors revenue against a monthly goal (default: $2,500/mo).

## Honest expectations — read this first

- **No software can guarantee income.** The $2,500/month figure is a *goal the
  system tracks*, not a promise. Revenue depends on your niche, audience
  growth, and the monetization deals (affiliate links, sponsorships, digital
  products) you land. The agent helps you produce consistent, high-quality
  content and shows you the gap to your goal — closing the gap is a business
  outcome, not a code feature.
- **Instagram's terms require a human accountable for the account.** This
  system uses only the official Graph API (no scraping, no engagement bots, no
  fake followers — those get accounts banned). By default every post goes
  through a **human approval queue** before publishing. You can enable
  auto-publish (`approval.mode: auto`) once you trust the output, but you
  remain responsible for what the account posts.
- **Disclose AI involvement** where your jurisdiction or platform policy
  requires it (e.g. EU AI Act transparency rules, FTC endorsement guides for
  sponsored posts).

## What it automates

| Stage | What happens |
|---|---|
| **Plan** | Claude generates a 7-day content calendar for your niche (post ideas, formats, hooks, best posting times). |
| **Generate** | Claude writes the caption, hashtags, alt text, and an image brief for each planned post. Drafts land in the approval queue. |
| **Review** | You approve/reject drafts from the CLI (or enable auto mode). |
| **Publish** | Approved posts are published via the Instagram Graph API at their scheduled time. |
| **Analyze** | Pulls post insights (reach, likes, saves, comments) and account metrics; Claude summarizes what's working and adjusts the next plan. |
| **Revenue** | You log income (affiliate, sponsorship, product sales); the tracker reports progress toward the monthly goal and Claude suggests monetization moves. |

## Requirements

- Python 3.10+
- An **Instagram Professional account** (Creator or Business) linked to a
  Facebook Page, and a Meta app with `instagram_content_publish`,
  `instagram_basic`, and `pages_read_engagement` permissions.
  See: https://developers.facebook.com/docs/instagram-platform/content-publishing
- An Anthropic API key: https://platform.claude.com/
- Images are generated automatically from each post's image brief
  (Pollinations text-to-image, free, no key). Set `IMGBB_API_KEY` to re-host
  them on imgbb for stable permanent URLs, or set `images.provider: none` in
  `config.yaml` to supply your own image URLs during review. Note: check the
  image provider's license terms for commercial use.

## Setup

```bash
cd instagram-creator-agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in your keys
# edit config.yaml         # your niche, voice, schedule, revenue goal
```

## Usage

```bash
python -m src.agent.main whoami        # verify IG credentials resolve to your account
python -m src.agent.main plan          # generate this week's content calendar
python -m src.agent.main generate      # draft captions for planned posts -> approval queue
python -m src.agent.main review        # interactively approve/reject drafts
python -m src.agent.main publish       # publish approved posts that are due
python -m src.agent.main report        # analytics + revenue vs. goal, with Claude's recommendations
python -m src.agent.main engage        # draft + send replies to comments on recent posts
python -m src.agent.main log-revenue 150 --source affiliate --note "Amazon storefront"
```

### Running it autonomously

Schedule the pipeline with cron (the approval step is the only human touch;
set `approval.mode: auto` in `config.yaml` to remove it — at your own risk):

```cron
0 7 * * MON  cd /path/to/instagram-creator-agent && .venv/bin/python -m src.agent.main plan
0 8 * * *    cd /path/to/instagram-creator-agent && .venv/bin/python -m src.agent.main generate
*/30 * * * * cd /path/to/instagram-creator-agent && .venv/bin/python -m src.agent.main publish
0 21 * * SUN cd /path/to/instagram-creator-agent && .venv/bin/python -m src.agent.main report
```

## Architecture

```
config.yaml ──┐
              ▼
  ContentGenerator (Claude API: claude-opus-5, structured outputs)
              │  drafts
              ▼
  ApprovalQueue (data/queue/*.json)  ◄── human review (or auto mode)
              │  approved + due
              ▼
  InstagramPublisher (Graph API: create container → publish)
              │
              ▼
  Analytics (Graph API insights) ──► RevenueTracker (data/revenue.json)
              └──────────► Claude weekly report & plan adjustments
```
