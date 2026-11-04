"""Speech recognition on this machine (OPEN_MODE=local): Whisper through faster-whisper.

The model is loaded once per process and shared by every session (Pipecat's WhisperSTTService
would load it again for each conversation). On an NVIDIA GPU it needs cuBLAS 12 and cuDNN 9,
which come as Python packages (`uv sync --group local`); on Windows their DLL folders are not on
the search path by themselves, so they are added here. With device "auto" a GPU that fails
(missing libraries, too little memory) falls back to the CPU instead of failing the bot.
"""

import os
import sys
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, override

from loguru import logger
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.transcriptions.language import Language

if TYPE_CHECKING:
    from faster_whisper import WhisperModel


def _add_cuda_dlls() -> None:
    """Put the pip-installed NVIDIA DLL folders (nvidia/*/bin) on the Windows search path."""
    if sys.platform != "win32":
        return
    try:
        import nvidia  # namespace package of nvidia-cublas-cu12 and nvidia-cudnn-cu12
    except ImportError:
        return
    for root in map(Path, nvidia.__path__):
        for folder in root.glob("*/bin"):
            os.add_dll_directory(str(folder))
            # CTranslate2 loads cuBLAS with a plain LoadLibrary, which reads PATH.
            os.environ["PATH"] = f"{folder}{os.pathsep}{os.environ.get('PATH', '')}"


@lru_cache
def load_whisper(model: str, device: str) -> tuple[str, "WhisperModel"]:
    """The shared Whisper model and the device it ended up on: ("cuda" | "cpu", model)."""
    import numpy as np
    from faster_whisper import WhisperModel

    _add_cuda_dlls()
    # int8 weights on the GPU: about 1 GB instead of 1.6, so the language model keeps more of the
    # GPU; on the CPU large-v3-turbo takes several seconds per sentence (a fallback, not a choice).
    gpu, cpu = ("cuda", "int8_float16"), ("cpu", "int8")
    tries = {"auto": [gpu, cpu], "cuda": [gpu], "cpu": [cpu]}.get(device, [(device, "default")])
    last: Exception | None = None
    for dev, compute in tries:
        try:
            whisper = WhisperModel(model, device=dev, compute_type=compute)
            # One short silent pass: a GPU without its libraries fails here, not mid-conversation.
            segments, _ = whisper.transcribe(np.zeros(16000, dtype=np.float32), language="hr")
            list(segments)
        except Exception as e:  # noqa: BLE001 - any failure: try the next device
            logger.warning(f"Whisper {model} on {dev} failed: {e}")
            last = e
        else:
            logger.info(f"Whisper {model} ready on {dev} ({compute})")
            return dev, whisper
    raise RuntimeError(f"Whisper {model} could not be loaded") from last


class LocalWhisperSTTService(WhisperSTTService):
    """Pipecat's Whisper service, reading the shared model instead of loading its own."""

    def __init__(self, *, model: str, device: str = "auto") -> None:
        self._shared = (model, device)  # set first: super().__init__() calls _load()
        super().__init__(settings=WhisperSTTService.Settings(model=model, language=Language.HR))

    @override
    def _load(self) -> None:
        model, device = self._shared
        self._device, self._model = load_whisper(model, device)


def preload(model: str, device: str) -> None:
    """Load Whisper before the first visitor (blocking: call it in a thread)."""
    load_whisper(model, device)
