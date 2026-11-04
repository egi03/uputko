"""Tool schemas from agent/tools.schema.json and calls to the shared backend /tools/*.

The open bot does not duplicate tool logic: every call goes to the same endpoints as the
premium agent, with X-Tool-Secret and X-Profile: open. conversation_id is the Pipecat session
ID set by the bot, never by the LLM.
"""

import json
import re
import unicodedata
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from loguru import logger
from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams

from bot.config import AGENT_DIR

HIDDEN_PARAMS = {"conversation_id"}

ERROR_RESULT = {
    "status": "error",
    "summary_hr": "Podaci trenutno nisu dostupni.",
    "source": "Uputko",
}
# A tool that needs a place, about to be called without one: the bot asks for it instead of
# sending the call (the backend would refuse it). not_found for a place is what the prompt
# answers by asking for the place again.
ASK_PLACE_RESULT = {
    "status": "not_found",
    "summary_hr": "Za koje mjesto?",
    "source": "Uputko",
}


def load_contract(path: Path | None = None) -> dict[str, Any]:
    text = (path or AGENT_DIR / "tools.schema.json").read_text(encoding="utf-8")
    contract: dict[str, Any] = json.loads(text)
    return contract


def function_schemas(contract: dict[str, Any]) -> list[FunctionSchema]:
    """One FunctionSchema per tool, without the parameters the bot fills itself."""
    schemas = []
    for tool in contract["tools"]:
        params = tool["parameters"]
        props = {k: v for k, v in params["properties"].items() if k not in HIDDEN_PARAMS}
        required = [r for r in params.get("required", []) if r not in HIDDEN_PARAMS]
        schemas.append(
            FunctionSchema(
                name=tool["name"],
                description=tool["description"],
                properties=props,
                required=required,
            )
        )
    return schemas


def tools_schema(contract: dict[str, Any]) -> ToolsSchema:
    return ToolsSchema(standard_tools=function_schemas(contract))


class ToolClient:
    """Calls /tools/* on the backend for one conversation."""

    def __init__(
        self,
        base_url: str,
        secret: str,
        conversation_id: str,
        timeout_s: float = 5.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.conversation_id = conversation_id
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout_s,
            headers={"X-Tool-Secret": secret, "X-Profile": "open"},
            transport=transport,
        )

    async def call(self, path: str, arguments: dict[str, Any]) -> dict[str, Any]:
        body = {**arguments, "conversation_id": self.conversation_id}
        try:
            resp = await self._client.post(path, json=body)
            resp.raise_for_status()
            result: dict[str, Any] = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning(f"tool {path} failed: {exc}")
            return dict(ERROR_RESULT)
        return result

    async def aclose(self) -> None:
        await self._client.aclose()


def _fold(text: str) -> str:
    """Lower case without diacritics: "Županji" -> "zupanji"."""
    decomposed = unicodedata.normalize("NFKD", text.casefold().replace("đ", "d"))
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def place_was_said(place: str, said: list[str]) -> bool:
    """Whether the user named this place, in any case form: "Vinkovci" in "blizu Vinkovaca".

    Each word of the place must appear in what the user said by its stem (the word without its
    last two letters, at least three), so declension and lower case still match: "Puli" for Pula.
    """
    heard = _fold(" ".join(said))
    words = [w for w in _fold(place).replace("-", " ").split() if len(w) > 2]
    return bool(words) and all(w[: max(3, len(w) - 2)] in heard for w in words)


def _phrase(text: str) -> str:
    """Folded words only: "Novigrad u Istarskoj županiji?" -> "novigrad u istarskoj zupaniji"."""
    return " ".join(re.findall(r"\w+", _fold(text)))


def place_was_offered(place: str, names: Sequence[str], question: str) -> bool:
    """Whether a place is one of the options an ambiguous answer offered: a candidate's name
    ("Novigrad", "Novigrad – Cittanova") or an option as the answer's question named it
    ("Novigrad u Istarskoj županiji", "Luka u gradu Vrbovec"). The contract tells the model to
    send the choice in those words, which the user may never have said ("Prvo.", "U Istri.")."""
    chosen = _phrase(place)
    asked = f" {_phrase(question)} "
    for name in names:
        forms = {_phrase(name), _phrase(name.partition(" – ")[0])} - {""}
        if chosen in forms:
            return True
        if any(chosen.startswith(f"{form} ") for form in forms) and f" {chosen} " in asked:
            return True
    return False


@dataclass
class Places:
    """The places tool calls of one conversation may carry: those the user named, and the
    options of the most recent ambiguous answer about a place."""

    said: Callable[[], list[str]]  # what the user has said or typed so far
    offered: tuple[str, ...] = ()  # candidate names of that answer
    question: str = ""  # its summary_hr, which names the options

    def allows(self, place: str) -> bool:
        return place_was_said(place, self.said()) or place_was_offered(
            place, self.offered, self.question
        )

    def remember(self, result: Mapping[str, Any]) -> None:
        """Keep the options of an ambiguous answer about a place."""
        if result.get("status") != "ambiguous":
            return
        names = tuple(
            c["name"]
            for c in result.get("candidates") or []
            if isinstance(c, dict) and c.get("kind", "place") == "place" and c.get("name")
        )
        if names:
            self.offered, self.question = names, str(result.get("summary_hr", ""))


def make_handler(
    client: ToolClient,
    tool: Mapping[str, Any],
    on_card: Callable[[str], Awaitable[None]],
    places: Places | None = None,
) -> Callable[[FunctionCallParams], Awaitable[None]]:
    """Pipecat function handler for a tool of the contract: call the backend, return the result,
    announce the card.

    A place that is neither named by the user nor offered by an ambiguous answer is a guess of
    the language model (smaller local models do that): it is dropped, so the tool answers for all
    of Croatia and asks for the place instead of answering for the wrong one. A tool that needs a
    place is not called without one: the answer asks "Za koje mjesto?".
    """
    path: str = tool["path"]
    needs_place = "location" in tool["parameters"].get("required", [])

    async def handler(params: FunctionCallParams) -> None:
        arguments = dict(params.arguments)
        place = arguments.get("location")
        if places is not None and isinstance(place, str) and not places.allows(place):
            logger.info(f"tool {path}: dropped location {place!r}, neither named nor offered")
            arguments.pop("location")
        if needs_place and not str(arguments.get("location") or "").strip():
            result = dict(ASK_PLACE_RESULT)
        else:
            result = await client.call(path, arguments)
        if places is not None:
            places.remember(result)
        card_id = result.pop("card_id", None)
        await params.result_callback(result)
        if card_id:
            await on_card(card_id)

    return handler
