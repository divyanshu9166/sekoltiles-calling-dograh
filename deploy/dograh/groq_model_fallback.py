"""Per-call Groq model fallback for the Sekol Dograh deployment.

The configured Dograh model remains primary. If Groq rejects a completion
before emitting any output with a retryable error (most importantly HTTP 429),
the same call switches to DOGRAH_GROQ_FALLBACK_MODEL for the rest of the run.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from typing import Any

from loguru import logger
from pipecat.services.groq.llm import GroqLLMService


DEFAULT_FALLBACK_MODEL = "openai/gpt-oss-20b"
RETRYABLE_STATUS_CODES = {408, 409, 429}


def _status_code(exc: Exception) -> int | None:
    value = getattr(exc, "status_code", None)
    if isinstance(value, int):
        return value

    response = getattr(exc, "response", None)
    value = getattr(response, "status_code", None)
    return value if isinstance(value, int) else None


def _is_retryable_model_error(exc: Exception) -> bool:
    status = _status_code(exc)
    if status in RETRYABLE_STATUS_CODES or (status is not None and status >= 500):
        return True

    # OpenAI-compatible clients use these names for failures that are safe to
    # retry against another model. Keeping this name-based avoids coupling the
    # deployment patch to one SDK version inside Dograh's image.
    return type(exc).__name__ in {
        "APIConnectionError",
        "APITimeoutError",
        "InternalServerError",
        "RateLimitError",
    }


class FallbackGroqLLMService(GroqLLMService):
    """Groq service that fails over once, without replaying partial speech."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._primary_model = self._settings.model
        self._fallback_model = (
            os.getenv("DOGRAH_GROQ_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL).strip()
            or DEFAULT_FALLBACK_MODEL
        )
        self._fallback_active = self._primary_model == self._fallback_model

    def _activate_fallback(self, exc: Exception) -> bool:
        if self._fallback_active or not _is_retryable_model_error(exc):
            return False

        self._fallback_active = True
        self._settings.model = self._fallback_model
        self.set_full_model_name(self._fallback_model)
        logger.warning(
            "Groq primary model {} failed with {}; switching this call to {}",
            self._primary_model,
            type(exc).__name__,
            self._fallback_model,
        )
        return True

    async def get_chat_completions(self, context: Any) -> AsyncIterator[Any]:
        primary_stream = None
        try:
            primary_stream = await super().get_chat_completions(context)
        except Exception as exc:
            if not self._activate_fallback(exc):
                raise

        async def stream_with_fallback() -> AsyncIterator[Any]:
            emitted_output = False
            if primary_stream is not None:
                try:
                    async for chunk in primary_stream:
                        emitted_output = True
                        yield chunk
                    return
                except Exception as exc:
                    # Replaying after partial output could duplicate speech or
                    # function calls, so only fail over before the first chunk.
                    if emitted_output or not self._activate_fallback(exc):
                        raise

            fallback_stream = await super(
                FallbackGroqLLMService, self
            ).get_chat_completions(context)
            async for chunk in fallback_stream:
                yield chunk

        return stream_with_fallback()

    async def run_inference(
        self,
        context: Any,
        max_tokens: int | None = None,
        system_instruction: str | None = None,
    ) -> str | None:
        try:
            return await super().run_inference(
                context,
                max_tokens=max_tokens,
                system_instruction=system_instruction,
            )
        except Exception as exc:
            if not self._activate_fallback(exc):
                raise
            return await super().run_inference(
                context,
                max_tokens=max_tokens,
                system_instruction=system_instruction,
            )
