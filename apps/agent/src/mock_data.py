from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


DATA_DIR = Path(__file__).resolve().parents[2] / "web" / "data"


def _load_json(filename: str) -> list[dict[str, Any]]:
    with (DATA_DIR / filename).open("r", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def load_summary_values() -> list[dict[str, Any]]:
    return _load_json("summary-values.json")


@lru_cache(maxsize=1)
def load_items() -> list[dict[str, Any]]:
    return _load_json("items.json")


@lru_cache(maxsize=1)
def load_chart_data() -> list[dict[str, Any]]:
    return _load_json("chart-data.json")


@lru_cache(maxsize=1)
def load_alerts() -> list[dict[str, Any]]:
    return _load_json("alerts.json")


def build_page_summary() -> dict[str, Any]:
    items = load_items()
    alerts = load_alerts()
    summary = load_summary_values()

    status_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}
    for item in items:
        status = item["status"]
        category = item["category"]
        status_counts[status] = status_counts.get(status, 0) + 1
        category_counts[category] = category_counts.get(category, 0) + 1

    return {
        "summary_values": summary,
        "status_counts": status_counts,
        "category_counts": category_counts,
        "top_alerts": alerts[:3],
    }
