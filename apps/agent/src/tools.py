from __future__ import annotations

import json
from typing import Any

from livekit.agents import ToolError, get_job_context

from mock_data import build_page_summary, load_alerts, load_items


def _linked_participant_identity() -> str:
    room = get_job_context().room
    try:
        return next(iter(room.remote_participants))
    except StopIteration as exc:
        raise ToolError("The frontend is not connected yet.") from exc


async def call_frontend_rpc(
    method: str,
    payload: dict[str, Any] | None = None,
    response_timeout: float = 5.0,
) -> dict[str, Any]:
    room = get_job_context().room
    identity = _linked_participant_identity()

    try:
        response = await room.local_participant.perform_rpc(
            destination_identity=identity,
            method=method,
            payload=json.dumps(payload or {}),
            response_timeout=response_timeout,
        )
    except Exception as exc:
        raise ToolError(f"{method} failed on the frontend.") from exc

    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"raw": response}


def get_items_data() -> list[dict[str, Any]]:
    return load_items()


def summarize_page_data_payload() -> dict[str, Any]:
    summary = build_page_summary()
    items = load_items()
    alerts = load_alerts()

    highest = max(items, key=lambda item: item["score"])
    lowest = min(items, key=lambda item: item["score"])

    return {
        **summary,
        "highest_score_item": highest,
        "lowest_score_item": lowest,
        "alert_count": len(alerts),
        "item_count": len(items),
    }


def query_items(question_or_filter: str) -> dict[str, Any]:
    query = question_or_filter.strip().lower()
    items = load_items()
    alerts = load_alerts()

    matched_items = [
        item
        for item in items
        if query in json.dumps(item).lower()
        or query in item["category"].lower()
        or query in item["status"].lower()
        or query in item["owner"].lower()
        or query in item["name"].lower()
    ]

    if "blocked" in query:
        matched_items = [item for item in items if item["status"] == "Blocked"]
    elif "live" in query:
        matched_items = [item for item in items if item["status"] == "Live"]
    elif "building" in query:
        matched_items = [item for item in items if item["status"] == "Building"]
    elif "finance" in query:
        matched_items = [item for item in items if item["category"] == "Finance"]
    elif "operations" in query:
        matched_items = [item for item in items if item["category"] == "Operations"]
    elif "growth" in query:
        matched_items = [item for item in items if item["category"] == "Growth"]
    elif "support" in query:
        matched_items = [item for item in items if item["category"] == "Support"]

    return {
        "query": question_or_filter,
        "matched_count": len(matched_items),
        "matched_items": matched_items[:6],
        "related_alerts": alerts[:2],
    }

