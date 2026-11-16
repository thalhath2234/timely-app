"""Photos on a chat turn (phase 8, Q7; PROTOCOL.md section 15): ``run.start.images``.

Go sends each photo as ``{mime, data_b64}`` (at most ``MAX_IMAGES``, each at most ``MAX_BYTES``
decoded). The worker hands them to Hermes the way its own adapters do (``acp_adapter.content``):
the turn's user message becomes a list of OpenAI content parts, the text first, then one
``image_url`` part per photo with a ``data:`` URL. Hermes' transports turn those parts into each
provider's own image format.

The run's model must read images: ``run.start.model.supports_vision`` is ``true`` (Go decides it,
``chat.readsImages``). Otherwise the run fails with ``VISION_MISSING`` before Hermes is touched.
Hermes' own answer for a model without vision is to describe each photo with ``vision_analyze``
on an auxiliary model, which writes the photo to a temp file and sends it to a second provider:
never acceptable for a Sensitive chat. With vision confirmed by Go, the agent is told so for the
turn (``vouch``), so Hermes never takes that path even when its model catalog does not know the
model (the Go gateway's ``custom`` provider).

What Hermes stores for the turn is the text alone (``persist_user_message``): a persisting run's
``state.db`` never holds the photos. Photo chats are Sensitive, so in practice they run no-persist
and nothing is stored at all.
"""

from __future__ import annotations

import base64
import binascii
from typing import Any, Optional

MAX_IMAGES = 4
MAX_BYTES = 5 * 1024 * 1024
MIMES = frozenset({"image/png", "image/jpeg", "image/webp", "image/gif"})
VISION_MISSING = ("This model can't read photos. Pick a model that reads images for this chat, "
                  "or send the message without photos.")
ERROR_KIND_VISION = "no_vision"


def _decode(data: str) -> bytes:
    return base64.b64decode(data, validate=True)


def problem(value: Any) -> Optional[str]:
    """Why ``run.start.images`` has the wrong shape, else None (``bad_message`` in the worker)."""
    if value is None:
        return None
    if not isinstance(value, list):
        return f"images must be a list, not {type(value).__name__}"
    if len(value) > MAX_IMAGES:
        return f"images holds {len(value)} photos; at most {MAX_IMAGES} are allowed"
    for i, image in enumerate(value):
        if not isinstance(image, dict):
            return f"images[{i}] must be an object with mime and data_b64"
        mime, data = image.get("mime"), image.get("data_b64")
        if mime not in MIMES:
            return f"images[{i}].mime must be one of {sorted(MIMES)}, not {mime!r}"
        if not isinstance(data, str) or not data:
            return f"images[{i}].data_b64 must be a non-empty base64 string"
        # base64 grows by 4/3: a string this long cannot decode within the limit
        if len(data) > (MAX_BYTES * 4) // 3 + 4:
            return f"images[{i}] is larger than {MAX_BYTES // (1024 * 1024)} MB"
        try:
            raw = _decode(data)
        except (binascii.Error, ValueError):
            return f"images[{i}].data_b64 is not valid base64"
        if not raw:
            return f"images[{i}] is empty"
        if len(raw) > MAX_BYTES:
            return f"images[{i}] is larger than {MAX_BYTES // (1024 * 1024)} MB"
    return None


def of(msg: dict[str, Any]) -> list[dict[str, str]]:
    value = msg.get("images")
    return [i for i in value if isinstance(i, dict)] if isinstance(value, list) else []


def reads_images(model: Any) -> bool:
    """Go said the run's model reads images (``model.supports_vision`` is exactly true)."""
    return isinstance(model, dict) and model.get("supports_vision") is True


def vision_problem(msg: dict[str, Any]) -> Optional[str]:
    """The reason a run with photos cannot run on its model, else None."""
    if of(msg) and not reads_images(msg.get("model")):
        return VISION_MISSING
    return None


def user_content(text: str, images: list[dict[str, str]]) -> Any:
    """The turn's user message for Hermes: ``text`` alone without photos, else content parts."""
    if not images:
        return text
    parts: list[dict[str, Any]] = [{"type": "text", "text": text}] if text else []
    for image in images:
        url = f"data:{image['mime']};base64,{image['data_b64']}"
        parts.append({"type": "image_url", "image_url": {"url": url}})
    return parts


def _sees() -> bool:
    return True


def vouch(agent: Any, on: bool) -> None:
    """Tell ``agent`` for this turn that its model reads images (Go confirmed it), or take that
    back. An instance attribute over Hermes' ``VisionMessagePrepMixin._model_supports_vision``,
    as ``run_chat`` replaces ``_dump_api_request_debug``: no patch point."""
    if on:
        agent._model_supports_vision = _sees
    else:
        agent.__dict__.pop("_model_supports_vision", None)
