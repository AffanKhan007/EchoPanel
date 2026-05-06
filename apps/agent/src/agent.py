from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any, Callable
from urllib import parse as urllib_parse
from urllib import error as urllib_error
from urllib import request as urllib_request

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
RAG_API_URL = os.getenv("RAG_API_URL", "").rstrip("/")
RAG_API_KEY = os.getenv("RAG_API_KEY", "")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "")
WEATHER_API_BASE_URL = os.getenv("WEATHER_API_BASE_URL", "https://api.weatherapi.com/v1").rstrip("/")
ROUTER_PROMPT = """
You are a routing classifier for EchoPanel.

Choose exactly one route for the user's question:
- general: use the normal assistant
- rag: use the uploaded document backend
- weather: use the live weather API

Return rag only when the question clearly depends on uploaded files, documents, notes, PDFs, reports, policies, or asks to answer from documents.
Return weather when the user is asking for weather, temperature, rain, forecast, humidity, wind, or conditions for a place.
If uploaded documents exist, prefer rag for factual questions that could reasonably be answered from those documents, even if the user does not explicitly say "according to the document".
Return general mainly for broad knowledge, casual chat, coding explanations, jokes, opinions, or requests that are clearly not about the uploaded documents or live weather.

Return strict JSON with this shape:
{"route":"general|rag|weather","location":"<place or empty string>"}

If route is weather, extract the place into location.
If no place is present for a weather question, use an empty string for location.
Do not add any extra text.
""".strip()
latency_logger = logging.getLogger("echo.latency")

DOCUMENT_HINT_PATTERNS = (
    "according to",
    "document",
    "documented",
    "file",
    "files",
    "from the upload",
    "from the uploaded",
    "from the doc",
    "from the docs",
    "in the upload",
    "in the uploaded",
    "in the document",
    "in the documents",
    "knowledge base",
    "notes",
    "pdf",
    "report",
    "uploaded",
)

WEATHER_HINT_PATTERNS = (
    "forecast",
    "humidity",
    "rain",
    "temperature",
    "weather",
    "wind",
)

GENERAL_HINT_PATTERNS = (
    "api",
    "code",
    "coding",
    "explain react",
    "how do apis work",
    "joke",
    "opinion",
    "write code",
)

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


def _latest_user_text(chat_ctx: llm.ChatContext) -> str:
    for item in reversed(chat_ctx.items):
        if isinstance(item, llm.ChatMessage) and item.role == "user":
            return (item.text_content or "").strip()
    return ""


def _normalized_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _contains_any(text: str, patterns: tuple[str, ...]) -> bool:
    return any(pattern in text for pattern in patterns)


def _looks_like_document_question(text: str) -> bool:
    normalized = _normalized_text(text)
    if not normalized:
        return False

    if _contains_any(normalized, DOCUMENT_HINT_PATTERNS):
        return True

    return normalized.startswith(
        (
            "what",
            "when",
            "where",
            "which",
            "who",
            "why",
            "how",
            "summarize",
            "summarise",
            "tell me about",
        )
    )


def _looks_like_general_question(text: str) -> bool:
    normalized = _normalized_text(text)
    if not normalized:
        return False

    return _contains_any(normalized, GENERAL_HINT_PATTERNS)


def _looks_like_weather_question(text: str) -> bool:
    normalized = _normalized_text(text)
    if not normalized:
        return False

    return _contains_any(normalized, WEATHER_HINT_PATTERNS)


def _extract_weather_location(text: str) -> str:
    normalized = _normalized_text(text)
    if not normalized:
        return ""

    patterns = [
        r"(?:weather|forecast|temperature|humidity|wind)\s+(?:in|for|of)\s+([a-z][a-z\s'-]+)",
        r"(?:in|for|of)\s+([a-z][a-z\s'-]+)\s+(?:weather|forecast|temperature|humidity|wind)",
        r"(?:tell me|what(?:'s| is)|give me)\s+(?:the\s+)?(?:weather|forecast|temperature)\s+(?:in|for|of)\s+([a-z][a-z\s'-]+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, normalized)
        if match:
            location = match.group(1).strip(" .?!,")
            if location:
                return " ".join(part.capitalize() for part in location.split())

    return ""


def _parse_document_ids(raw_value: str | None) -> list[int]:
    if not raw_value:
        return []

    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError:
        return []

    if not isinstance(payload, list):
        return []

    return [item for item in payload if isinstance(item, int)]


class RagClient:
    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url
        self._api_key = api_key

    @property
    def enabled(self) -> bool:
        return bool(self._base_url and self._api_key)

    async def ask_docs(self, question: str, document_ids: list[int]) -> str:
        return await asyncio.to_thread(self._ask_docs_sync, question, document_ids)

    def _ask_docs_sync(self, question: str, document_ids: list[int]) -> str:
        payload = json.dumps(
            {
                "question": question,
                "document_ids": document_ids,
                "debug": True,
            }
        ).encode("utf-8")
        request = urllib_request.Request(
            f"{self._base_url}/ask-docs",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "X-API-Key": self._api_key,
                "X-Client-App": "EchoPanel",
            },
            method="POST",
        )

        try:
            with urllib_request.urlopen(request, timeout=20) as response:
                raw = response.read().decode("utf-8")
        except urllib_error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="ignore")
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = {}

            message = payload.get("error") or payload.get("message") or str(error)
            raise RuntimeError(message) from error
        except urllib_error.URLError as error:
            raise RuntimeError("Unable to reach the document service.") from error

        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError as error:
            raise RuntimeError("Document service returned invalid JSON.") from error

        answer = payload.get("answer")
        if not isinstance(answer, str) or not answer.strip():
            raise RuntimeError("Document service returned an empty answer.")

        return answer.strip()


class WeatherClient:
    def __init__(self, api_key: str, base_url: str) -> None:
        self._api_key = api_key
        self._base_url = base_url

    @property
    def enabled(self) -> bool:
        return bool(self._api_key)

    async def current_weather(self, location: str) -> str:
        return await asyncio.to_thread(self._current_weather_sync, location)

    def _current_weather_sync(self, location: str) -> str:
        params = urllib_parse.urlencode(
            {
                "aqi": "no",
                "key": self._api_key,
                "q": location,
            }
        )
        url = f"{self._base_url}/current.json?{params}"

        try:
            with urllib_request.urlopen(url, timeout=20) as response:
                raw = response.read().decode("utf-8")
        except urllib_error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="ignore")
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = {}

            api_error = payload.get("error")
            if isinstance(api_error, dict):
                message = api_error.get("message") or str(error)
            else:
                message = str(error)
            raise RuntimeError(message) from error
        except urllib_error.URLError as error:
            raise RuntimeError("Unable to reach the weather service.") from error

        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError as error:
            raise RuntimeError("Weather service returned invalid JSON.") from error

        location_data = payload.get("location") or {}
        current = payload.get("current") or {}
        condition = current.get("condition") or {}

        place = location_data.get("name") or location
        region = location_data.get("region")
        country = location_data.get("country")
        summary_place = place
        if isinstance(region, str) and region and region.lower() != place.lower():
            summary_place = f"{summary_place}, {region}"
        if isinstance(country, str) and country:
            summary_place = f"{summary_place}, {country}"

        condition_text = condition.get("text") or "unknown conditions"
        temp_c = current.get("temp_c")
        feels_like_c = current.get("feelslike_c")
        humidity = current.get("humidity")
        wind_kph = current.get("wind_kph")

        parts: list[str] = [f"Current weather in {summary_place}: {condition_text}."]
        if isinstance(temp_c, (int, float)):
            parts.append(f"It is {temp_c:g} degrees Celsius")
            if isinstance(feels_like_c, (int, float)):
                parts[-1] += f", feeling like {feels_like_c:g} degrees Celsius."
            else:
                parts[-1] += "."
        if isinstance(humidity, (int, float)):
            parts.append(f"Humidity is {humidity:g}%.")
        if isinstance(wind_kph, (int, float)):
            parts.append(f"Wind is {wind_kph:g} kph.")

        return " ".join(parts)


class EchoBrowserAgent(Agent):
    def __init__(
        self,
        *,
        mode_provider: Callable[[], str],
        document_ids_provider: Callable[[], list[int]],
        rag_client: RagClient,
        weather_client: WeatherClient,
        router_llm: inference.LLM,
    ) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)
        self._latest_question = ""
        self._mode_provider = mode_provider
        self._document_ids_provider = document_ids_provider
        self._rag_client = rag_client
        self._weather_client = weather_client
        self._router_llm = router_llm

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        self._latest_question = (new_message.text_content or "").strip()

    def llm_node(
        self,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool],
        model_settings: Any,
    ) -> Any:
        mode = self._mode_provider()
        if mode == "general":
            return super().llm_node(chat_ctx, tools, model_settings)

        question = self._latest_question or _latest_user_text(chat_ctx)

        async def _route_or_answer() -> Any:
            route = "rag"
            weather_location = ""
            document_ids = self._document_ids_provider()
            if mode == "auto":
                route, weather_location = await self._route_question(
                    question,
                    has_documents=bool(document_ids),
                )
                latency_logger.info("auto route selected: %s", route)

            if route == "general":
                return super(EchoBrowserAgent, self).llm_node(chat_ctx, tools, model_settings)

            if route == "weather":
                if not self._weather_client.enabled:
                    latency_logger.warning(
                        "weather skipped because weather service is not configured"
                    )
                    return "The weather service is not configured right now."

                if not weather_location:
                    latency_logger.warning("weather skipped because location was missing")
                    return "Please tell me which city you want the weather for."

                try:
                    latency_logger.info("weather request: %s", weather_location)
                    return await self._weather_client.current_weather(weather_location)
                except Exception:
                    latency_logger.exception("weather request failed")
                    return "I can't reach the weather service right now."

            if not question:
                latency_logger.warning("ask-docs skipped because question was empty")
                return "I didn't catch a document question yet. Please try again."

            if not document_ids:
                latency_logger.warning("ask-docs skipped because no uploaded document ids were set")
                return "Please upload a document first so I know what to search."

            if not self._rag_client.enabled:
                latency_logger.warning(
                    "ask-docs skipped because document service is not configured"
                )
                return "The document service is not configured right now."

            try:
                latency_logger.info("ask-docs request: %s (document_ids=%s)", question, document_ids)
                return await self._rag_client.ask_docs(question, document_ids)
            except Exception:
                latency_logger.exception("ask-docs request failed")
                return "I can't reach the document service right now."

        return _route_or_answer()

    async def _route_question(self, question: str, has_documents: bool) -> tuple[str, str]:
        if not question:
            return ("general", "")

        if _looks_like_weather_question(question):
            location = _extract_weather_location(question)
            if location:
                return ("weather", location)

        if has_documents:
            if _looks_like_document_question(question) and not _looks_like_general_question(question):
                return ("rag", "")
        elif _looks_like_general_question(question):
            return ("general", "")

        router_ctx = llm.ChatContext.empty()
        router_ctx.add_message(
            role="system",
            content=f"{ROUTER_PROMPT}\nUploaded documents available: {'yes' if has_documents else 'no'}.",
        )
        router_ctx.add_message(role="user", content=question)
        stream = self._router_llm.chat(
            chat_ctx=router_ctx,
            tools=[],
            extra_kwargs={
                "max_completion_tokens": 40,
                "temperature": 0,
            },
        )

        decision_parts: list[str] = []
        async for chunk in stream:
            if chunk.delta and chunk.delta.content:
                decision_parts.append(chunk.delta.content)

        raw_decision = "".join(decision_parts).strip()
        try:
            parsed = json.loads(raw_decision)
        except json.JSONDecodeError:
            latency_logger.warning(
                "router returned invalid json: %s", raw_decision or "<empty>"
            )
            return ("general", "")

        route = str(parsed.get("route", "general")).strip().lower()
        location = str(parsed.get("location", "")).strip()
        if route not in {"general", "rag", "weather"}:
            latency_logger.warning("router returned unexpected decision: %s", route or "<empty>")
            return ("general", "")

        if has_documents and route == "general" and _looks_like_document_question(question):
            latency_logger.info("router general decision overridden to rag for document-style question")
            return ("rag", location)

        return (route, location)


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    participant = await ctx.wait_for_participant()
    rag_client = RagClient(RAG_API_URL, RAG_API_KEY)
    weather_client = WeatherClient(WEATHER_API_KEY, WEATHER_API_BASE_URL)
    router_llm = inference.LLM(
        model="openai/gpt-4.1-nano",
        extra_kwargs={
            "max_completion_tokens": 40,
            "temperature": 0,
        },
    )

    def current_mode() -> str:
        current_participant = ctx.room.remote_participants.get(participant.identity, participant)
        return current_participant.attributes.get("assistant.mode", "general")

    def current_document_ids() -> list[int]:
        current_participant = ctx.room.remote_participants.get(participant.identity, participant)
        return _parse_document_ids(current_participant.attributes.get("assistant.document_ids"))

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
        agent=EchoBrowserAgent(
            mode_provider=current_mode,
            document_ids_provider=current_document_ids,
            rag_client=rag_client,
            weather_client=weather_client,
            router_llm=router_llm,
        ),
    )

    async def greet_user() -> None:
        await session.say(
            GREETING_TEXT,
            allow_interruptions=True,
        )

    last_active = participant.attributes.get("session.state") == "active"

    if last_active:
        await greet_user()

    while ctx.room.isconnected():
        participant = ctx.room.remote_participants.get(participant.identity, participant)
        is_active = participant.attributes.get("session.state") == "active"

        if is_active and not last_active:
            await greet_user()

        last_active = is_active
        await asyncio.sleep(0.2)


if __name__ == "__main__":
    cli.run_app(server)
