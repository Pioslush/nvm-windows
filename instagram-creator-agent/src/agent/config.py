"""Load config.yaml + .env into one settings object."""

import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
QUEUE_DIR = DATA_DIR / "queue"
ANALYTICS_FILE = DATA_DIR / "analytics.json"
REVENUE_FILE = DATA_DIR / "revenue.json"
PLAN_FILE = DATA_DIR / "plan.json"


class Settings:
    def __init__(self) -> None:
        load_dotenv(ROOT / ".env")
        with open(ROOT / "config.yaml") as f:
            self.cfg = yaml.safe_load(f)

        self.anthropic_api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.ig_user_id = os.getenv("IG_USER_ID", "")
        self.ig_access_token = os.getenv("IG_ACCESS_TOKEN", "")

        self.model: str = self.cfg.get("model", "claude-opus-5")
        self.account: dict = self.cfg["account"]
        self.approval_mode: str = self.cfg["approval"]["mode"]
        self.posting: dict = self.cfg["posting"]
        self.monthly_goal: float = float(self.cfg["revenue"]["monthly_goal_usd"])
        self.revenue_streams: list[str] = self.cfg["revenue"]["streams"]

        for d in (DATA_DIR, QUEUE_DIR):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
