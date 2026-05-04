from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    AutoSubscribe,
    EndpointingOptions,
    JobContext,
    JobProcess,
    TurnHandlingOptions,
    cli,
    inference,
    llm,
)
from livekit.plugins import silero

from prompts import SYSTEM_PROMPT


load_dotenv()

AGENT_NAME = "echo-browser-copilot"
VOICE_ID = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
GREETING_TEXT = "Hello, how can I help you today?"
latency_logger = logging.getLogger("echo.latency")

server = AgentServer(
    load_threshold=0.95,
    num_idle_processes=1,
)


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load(activation_threshold=0.3)


server.setup_fnc = prewarm


def _format_ms(value: Any) -> str | None:
    if not isinstance(value, (int, float)):
        return None
    return f"{value * 1000:.0f}ms"


def _metrics_summary(metrics: dict[str, Any] | None, keys: list[str]) -> str:
    if not metrics:
        return "n/a"

    parts: list[str] = []
    for key in keys:
        value = _format_ms(metrics.get(key))
        if value is not None:
            parts.append(f"{key}={value}")

    return ", ".join(parts) if parts else "n/a"


def _interrupt_pending_reply(session: AgentSession) -> None:
    def _drain_interrupt_result(pending: asyncio.Future[Any]) -> None:
        try:
            pending.exception()
        except asyncio.CancelledError:
            return
        except Exception:
            latency_logger.exception("interrupt future failed")

    try:
        pending = session.interrupt(force=True)
        if isinstance(pending, asyncio.Future):
            pending.add_done_callback(_drain_interrupt_result)
    except Exception:
        latency_logger.exception("failed to interrupt pending reply")


class EchoBrowserAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    participant = await ctx.wait_for_participant()

    vad = ctx.proc.userdata["vad"]
    session = AgentSession(
        vad=vad,
        stt=inference.STT(
            model="assemblyai/u3-rt-pro",
            language="en",
            extra_kwargs={
                "min_turn_silence": 100,
                "max_turn_silence": 700,
                "vad_threshold": 0.3,
            },
        ),
        llm=inference.LLM(model="openai/gpt-4.1-nano"),
        tts=inference.TTS(
            model="cartesia/sonic-3",
            voice=VOICE_ID,
            extra_kwargs={
                "add_timestamps": False,
                "add_phoneme_timestamps": False,
                "max_buffer_delay_ms": 40,
            },
        ),
        turn_handling=TurnHandlingOptions(
            turn_detection="stt",
            endpointing=EndpointingOptions(
                mode="fixed",
                min_delay=0.0,
                max_delay=0.1,
            ),
            interruption={
                "mode": "adaptive",
            },
            preemptive_generation={
                "enabled": True,
                "preemptive_tts": True,
                "max_speech_duration": 6.0,
                "max_retries": 1,
            },
        ),
    )

    turn_probe: dict[str, Any] = {
        "id": 0,
        "final_transcript_at": None,
        "transcript": "",
        "active_reply_turn": None,
    }

    @session.on("user_input_transcribed")
    def _on_user_input_transcribed(event: Any) -> None:
        if not event.is_final:
            return

        previous_reply_turn = turn_probe.get("active_reply_turn")
        turn_probe["id"] += 1
        turn_probe["final_transcript_at"] = time.perf_counter()
        turn_probe["transcript"] = event.transcript.strip()
        latency_logger.info(
            "turn %s final transcript captured: %s",
            turn_probe["id"],
            turn_probe["transcript"] or "<empty>",
        )

        if previous_reply_turn is not None:
            latency_logger.info(
                "turn %s interrupting pending reply from turn %s",
                turn_probe["id"],
                previous_reply_turn,
            )
            turn_probe["active_reply_turn"] = None
            _interrupt_pending_reply(session)

    @session.on("speech_created")
    def _on_speech_created(event: Any) -> None:
        started_at = turn_probe.get("final_transcript_at")
        if started_at is None:
            return

        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        latency_logger.info(
            "turn %s speech handle created after %sms (source=%s)",
            turn_probe["id"],
            elapsed_ms,
            event.source,
        )

    @session.on("agent_state_changed")
    def _on_agent_state_changed(event: Any) -> None:
        started_at = turn_probe.get("final_transcript_at")
        if started_at is None:
            return

        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        if event.new_state == "thinking":
            turn_probe["active_reply_turn"] = turn_probe["id"]
            latency_logger.info(
                "turn %s agent entered thinking after %sms",
                turn_probe["id"],
                elapsed_ms,
            )
        elif event.new_state == "speaking":
            turn_probe["active_reply_turn"] = turn_probe["id"]
            latency_logger.info(
                "turn %s agent started speaking after %sms",
                turn_probe["id"],
                elapsed_ms,
            )

    @session.on("conversation_item_added")
    def _on_conversation_item_added(event: Any) -> None:
        if not isinstance(event.item, llm.ChatMessage):
            return

        if event.item.role == "user":
            latency_logger.info(
                "turn %s user metrics: %s",
                turn_probe["id"],
                _metrics_summary(
                    event.item.metrics,
                    ["end_of_turn_delay", "on_user_turn_completed_delay"],
                ),
            )
            return

        if event.item.role == "assistant":
            latency_logger.info(
                "turn %s assistant metrics: %s",
                turn_probe["id"],
                _metrics_summary(
                    event.item.metrics,
                    ["llm_node_ttft", "tts_node_ttfb", "e2e_latency"],
                ),
            )
            turn_probe["final_transcript_at"] = None
            turn_probe["active_reply_turn"] = None

    await session.start(
        room=ctx.room,
        agent=EchoBrowserAgent(),
    )

    last_active = participant.attributes.get("session.state") == "active"

    if last_active:
        await session.say(
            GREETING_TEXT,
            allow_interruptions=True,
        )

    while ctx.room.isconnected():
        participant = ctx.room.remote_participants.get(participant.identity, participant)
        is_active = participant.attributes.get("session.state") == "active"

        if is_active and not last_active:
            await session.say(
                GREETING_TEXT,
                allow_interruptions=True,
            )

        last_active = is_active
        await asyncio.sleep(0.2)


if __name__ == "__main__":
    cli.run_app(server)
