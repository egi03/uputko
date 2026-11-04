"""Pipecat pipeline:

transport in -> STT (Whisper, hr) -> user context -> LLM + tools -> TTS (CPU) -> transport out
-> assistant context

Whisper and the language model run on Groq (OPEN_MODE=groq) or on this machine (OPEN_MODE=local:
faster-whisper and Ollama, bot/local_stt.py and bot/local_llm.py).

RTVI is added by Pipecat itself; it carries transcripts, typed text (send-text) and our
server messages with card IDs to the page.
"""

import asyncio
import uuid
from collections.abc import Callable

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import EndFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame
from pipecat.services.groq.llm import GroqLLMService
from pipecat.services.groq.stt import GroqSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.stt_service import STTService
from pipecat.services.tts_service import TTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.turns.user_stop.speech_timeout_user_turn_stop_strategy import (
    SpeechTimeoutUserTurnStopStrategy,
)
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from bot.config import Settings, first_message, system_prompt
from bot.tools import Places, ToolClient, load_contract, make_handler, tools_schema

FIRST_MESSAGE = first_message()
# Said when the conversation reaches its time limit; neutral, like every answer.
TIME_LIMIT_MESSAGE = "Vrijeme razgovora je isteklo. Doviđenja."


def build_services(
    settings: Settings, tts_factory: Callable[[str], TTSService]
) -> tuple[STTService, OpenAILLMService, TTSService]:
    if settings.mode == "local":
        # Imported here: faster-whisper is only installed with `uv sync --group local`.
        from bot.local_llm import create_llm
        from bot.local_stt import LocalWhisperSTTService

        whisper = LocalWhisperSTTService(
            model=settings.local_stt_model, device=settings.local_stt_device
        )
        return whisper, create_llm(settings), tts_factory(settings.tts_model)
    stt = GroqSTTService(
        api_key=settings.groq_api_key,
        settings=GroqSTTService.Settings(model=settings.stt_model, language=Language.HR),
    )
    llm = GroqLLMService(
        api_key=settings.groq_api_key,
        settings=GroqLLMService.Settings(
            model=settings.llm_model, temperature=settings.llm_temperature
        ),
    )
    return stt, llm, tts_factory(settings.tts_model)


async def run_bot(
    connection: SmallWebRTCConnection,
    settings: Settings,
    tts_factory: Callable[[str], TTSService],
) -> None:
    session_id = f"open_{uuid.uuid4().hex[:16]}"
    logger.info(f"Starting open bot session {session_id}")

    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )
    stt, llm, tts = build_services(settings, tts_factory)

    contract = load_contract()
    context = LLMContext(
        messages=[{"role": "system", "content": system_prompt()}],
        tools=tools_schema(contract),
    )
    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.3)),
            user_turn_strategies=UserTurnStrategies(
                stop=[
                    SpeechTimeoutUserTurnStopStrategy(
                        user_speech_timeout=settings.user_speech_timeout_s
                    )
                ]
            ),
        ),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            aggregators.user(),
            llm,
            tts,
            transport.output(),
            aggregators.assistant(),
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True),
        conversation_id=session_id,
    )

    async def send_card(card_id: str) -> None:
        # The page fetches GET {OPEN_PUBLIC_API_URL}/api/cards/{card_id}.
        await worker.queue_frame(RTVIServerMessageFrame(data={"type": "card", "card_id": card_id}))

    tool_client = ToolClient(
        settings.tools_base_url, settings.tool_secret, session_id, settings.tool_timeout_s
    )

    def said() -> list[str]:
        """What the user has said or typed in this conversation."""
        return [
            content
            for m in context.get_messages()
            if isinstance(m, dict)
            and m.get("role") == "user"
            and isinstance(content := m.get("content"), str)
        ]

    places = Places(said)  # shared by the tools: a place offered by one can be chosen in another
    for tool in contract["tools"]:
        llm.register_function(tool["name"], make_handler(tool_client, tool, send_card, places))

    async def time_limit() -> None:
        await asyncio.sleep(settings.max_conversation_s)
        logger.info(f"{session_id}: time limit reached")
        await worker.queue_frames([TTSSpeakFrame(TIME_LIMIT_MESSAGE), EndFrame()])

    limiter: asyncio.Task[None] | None = None

    @transport.event_handler("on_client_connected")
    async def on_client_connected(
        _transport: SmallWebRTCTransport, _client: SmallWebRTCConnection
    ) -> None:
        nonlocal limiter
        context.add_message({"role": "assistant", "content": FIRST_MESSAGE})
        await worker.queue_frames([TTSSpeakFrame(FIRST_MESSAGE)])
        limiter = asyncio.create_task(time_limit())

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(
        _transport: SmallWebRTCTransport, _client: SmallWebRTCConnection
    ) -> None:
        logger.info(f"{session_id}: client disconnected")
        await worker.cancel()

    try:
        await PipelineRunner(handle_sigint=False).run(worker)
    finally:
        if limiter:
            limiter.cancel()
        await tool_client.aclose()
