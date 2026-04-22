from __future__ import annotations

import asyncio

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobProcess,
    RunContext,
    ToolError,
    TurnHandlingOptions,
    cli,
    function_tool,
    inference,
)
from livekit.plugins import silero

from prompts import SYSTEM_PROMPT
from tools import call_frontend_rpc, get_items_data, query_items, summarize_page_data_payload


load_dotenv()

AGENT_NAME = "echo-browser-copilot"
VOICE_ID = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"

server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


class EchoBrowserAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)

    @function_tool(name="query_data")
    async def query_data(
        self,
        context: RunContext,
        question_or_filter: str,
    ) -> dict:
        """Query local mock data using a natural-language question or simple filter phrase."""
        if not question_or_filter.strip():
            raise ToolError("Please provide a question or filter.")
        return query_items(question_or_filter)

    @function_tool(name="get_items")
    async def get_items(
        self,
        context: RunContext,
    ) -> list[dict]:
        """Return the current mock item collection shown in the demo."""
        return get_items_data()

    @function_tool(name="summarize_page_data")
    async def summarize_page_data(
        self,
        context: RunContext,
    ) -> dict:
        """Summarize the dashboard's mock data, status counts, and top alerts."""
        return summarize_page_data_payload()

    @function_tool(name="getCurrentPageContext")
    async def get_current_page_context(
        self,
        context: RunContext,
    ) -> dict:
        """Get structured frontend context about the currently visible page."""
        return await call_frontend_rpc("getCurrentPageContext")

    @function_tool(name="applyFilter")
    async def apply_filter(
        self,
        context: RunContext,
        field: str,
        op: str,
        value: str,
    ) -> dict:
        """Apply a safe UI filter on the frontend.

        Args:
            field: One of category, status, or search.
            op: The comparison operator requested by the user. Usually eq or contains.
            value: The filter value to apply.
        """
        return await call_frontend_rpc(
            "applyFilter",
            {"field": field, "op": op, "value": value},
        )

    @function_tool(name="openPanel")
    async def open_panel(
        self,
        context: RunContext,
        panel: str,
    ) -> dict:
        """Open a named side panel on the frontend. Use details, alerts, or insights."""
        return await call_frontend_rpc("openPanel", {"panel": panel})

    @function_tool(name="highlightWidget")
    async def highlight_widget(
        self,
        context: RunContext,
        widgetId: str,
    ) -> dict:
        """Temporarily highlight a widget on the frontend by widget id."""
        return await call_frontend_rpc("highlightWidget", {"widgetId": widgetId})


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    participant = await ctx.wait_for_participant()

    vad = ctx.proc.userdata["vad"]
    session = AgentSession(
        vad=vad,
        stt=inference.STT(
            model="deepgram/flux-general",
            language="en",
        ),
        llm=inference.LLM(model="openai/gpt-5-nano"),
        tts=inference.TTS(
            model="cartesia/sonic-3",
            voice=VOICE_ID,
        ),
        preemptive_generation=True,
        turn_handling=TurnHandlingOptions(
            turn_detection="stt",
            min_endpointing_delay=0.2,
            max_endpointing_delay=1.2,
        ),
        max_tool_steps=4,
    )

    await session.start(
        room=ctx.room,
        agent=EchoBrowserAgent(),
    )

    last_active = participant.attributes.get("session.state") == "active"

    if last_active:
        await session.say(
            "Hello, how can I help you today?",
            allow_interruptions=True,
        )

    while ctx.room.isconnected():
        participant = ctx.room.remote_participants.get(participant.identity, participant)
        is_active = participant.attributes.get("session.state") == "active"

        if is_active and not last_active:
            await session.say(
                "Hello, how can I help you today?",
                allow_interruptions=True,
            )

        last_active = is_active
        await asyncio.sleep(0.2)


if __name__ == "__main__":
    cli.run_app(server)
