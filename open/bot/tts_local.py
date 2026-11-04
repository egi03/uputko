"""Speech synthesis on CPU, inside the bot process (no external TTS service).

OPEN_TTS_MODEL selects the engine:
- a Coqui model name, e.g. "tts_models/hr/cv/vits" (coqui-tts, MPL-2.0);
- "piper:<voice>", e.g. "piper:sr_RS-serbski_institut-medium" (Pipecat's Piper service).
Text is split into sentences that keep dates whole (CroatianSentenceAggregator) and normalized
(numbers, dates, euros, phone numbers, abbreviations), see bot/text_normalize.py.
"""

import asyncio
import re
from collections.abc import AsyncGenerator, AsyncIterator
from functools import lru_cache
from typing import TYPE_CHECKING, override

from loguru import logger
from pipecat.frames.frames import ErrorFrame, Frame
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService
from pipecat.utils.text.base_text_aggregator import Aggregation, TextType
from pipecat.utils.text.simple_text_aggregator import SimpleTextAggregator

from bot.text_normalize import normalize

if TYPE_CHECKING:
    from TTS.api import TTS


# A full stop right after a digit, and the next character that is not a space.
_NUMBER_STOP = re.compile(r"\d\.(?=\s*(\S))")


def ordinal_stops_end(text: str) -> int:
    """Offset just after the last full stop that ends a number but not the sentence.

    "7. siječnja", "29. 10.", "(29. 10.)" and "2027., za 68 dana": after a digit, a full stop
    followed by a lower-case letter, a digit or one of ,;) marks an ordinal (a date), not the end
    of a sentence. 0 when the text has none.
    """
    end = 0
    for m in _NUMBER_STOP.finditer(text):
        after = m.group(1)
        if after.islower() or after.isdigit() or after in ",;)":
            end = m.end()
    return end


class CroatianSentenceAggregator(SimpleTextAggregator):
    """Pipecat's sentence aggregator that does not end a sentence inside a date.

    sentencex (Pipecat's match_endofsentence) ends a sentence after "7." in "Vinkovci: 7. siječnja
    2027., za 68 dana.", so speech synthesis got "…Vinkovci: 7." ("sedam.") and "siječnja
    2027., …", and normalize() never saw a whole date. Full stops that end an ordinal are hidden
    from the sentence check (see ordinal_stops_end). Pipecat checks a possible boundary only once
    the next non-space character has arrived, so text streamed token by token is split the same
    way as a whole reply.
    """

    def __init__(self) -> None:
        # Named rather than super(): Pipecat's __init__ has no types, and mypy's
        # untyped_calls_exclude recognizes it only by its full name.
        SimpleTextAggregator.__init__(self, aggregation_type=TextType.SENTENCE, language="hr")

    @override
    async def _check_sentence_with_lookahead(
        self, char: str, *, protected_end: int = 0
    ) -> Aggregation | None:
        protected = max(protected_end, ordinal_stops_end(self._text))
        return await super()._check_sentence_with_lookahead(char, protected_end=protected)


@lru_cache
def _load_coqui(model_name: str, device: str) -> "TTS":
    """Loaded once per process; every session's service shares the model."""
    from TTS.api import TTS  # heavy import, only when this engine is chosen

    logger.info(f"Loading Coqui model {model_name} on {device}")
    return TTS(model_name).to(device)


def preload(model: str) -> None:
    """Load the voice before the first visitor (blocking: call it in a thread)."""
    if not model.startswith("piper:"):
        _load_coqui(model, "cpu")


class CoquiTTSService(TTSService):
    """Pipecat TTS service around a local Coqui TTS model (e.g. Croatian VITS)."""

    def __init__(self, *, model_name: str, device: str = "cpu") -> None:
        super().__init__(
            push_start_frame=True,
            push_stop_frames=True,
            settings=TTSSettings(model=model_name, voice=None, language=None),
        )
        self._text_aggregator = CroatianSentenceAggregator()
        self._tts = _load_coqui(model_name, device)
        self._in_rate = int(self._tts.synthesizer.output_sample_rate)

    @override
    def can_generate_metrics(self) -> bool:
        return True

    def _synthesize(self, text: str) -> bytes:
        import numpy as np

        wav = np.asarray(self._tts.tts(text), dtype=np.float32)
        return (np.clip(wav, -1.0, 1.0) * 32767).astype(np.int16).tobytes()

    @override
    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        async def chunks() -> AsyncIterator[bytes]:
            yield await asyncio.to_thread(self._synthesize, spoken)

        try:
            spoken = normalize(text)
            await self.start_tts_usage_metrics(spoken)
            async for frame in self._stream_audio_frames_from_iterator(
                chunks(), in_sample_rate=self._in_rate, context_id=context_id
            ):
                await self.stop_ttfb_metrics()
                yield frame
        except Exception as exc:  # noqa: BLE001 - reported as an ErrorFrame, the session goes on
            logger.error(f"{self} exception: {exc}")
            yield ErrorFrame(error=f"TTS error: {exc}")
        finally:
            await self.stop_ttfb_metrics()


def create_tts(model: str) -> TTSService:
    if model.startswith("piper:"):
        from pipecat.services.piper.tts import PiperTTSService  # needs piper-tts

        class NormalizedPiperTTSService(PiperTTSService):
            """Piper with the same Croatian sentences and text normalization."""

            def __init__(self, *, voice: str) -> None:
                super().__init__(settings=PiperTTSService.Settings(voice=voice))
                self._text_aggregator = CroatianSentenceAggregator()

            @override
            async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
                async for frame in super().run_tts(normalize(text), context_id):
                    yield frame

        return NormalizedPiperTTSService(voice=model.removeprefix("piper:"))
    return CoquiTTSService(model_name=model)
