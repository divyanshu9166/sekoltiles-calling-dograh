"""Per-call Groq credential fallback for the Sekol Dograh deployment.

The configured Dograh model remains primary. If Groq rejects a completion
before emitting any output with a retryable error (most importantly HTTP 429),
the call can switch to a second Groq API key without changing its model or
conversation context. A process-wide cooldown avoids retrying the throttled
primary key on every new call. Until the backup key is configured, the existing
same-key model fallback remains active.
"""

from __future__ import annotations

import asyncio
import os
import threading
import time
from collections.abc import AsyncIterator
from typing import Any

from loguru import logger
from pipecat.services.groq.llm import GroqLLMService

from api.services.workflow.transfer_consent_guard import (
    reinforce_transfer_decline_context,
)


DEFAULT_FALLBACK_MODEL = "openai/gpt-oss-20b"
DEFAULT_FALLBACK_MAX_COMPLETION_TOKENS = 512
RETRYABLE_STATUS_CODES = {408, 409, 429}
_GROQ_COOLDOWN_UNTIL = 0.0
_GROQ_COOLDOWN_LOCK = threading.Lock()


def _groq_cooldown_remaining() -> float:
    with _GROQ_COOLDOWN_LOCK:
        return max(0.0, _GROQ_COOLDOWN_UNTIL - time.monotonic())


def _start_groq_cooldown(seconds: int) -> None:
    global _GROQ_COOLDOWN_UNTIL
    if seconds <= 0:
        return
    with _GROQ_COOLDOWN_LOCK:
        _GROQ_COOLDOWN_UNTIL = max(
            _GROQ_COOLDOWN_UNTIL, time.monotonic() + seconds
        )


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

    def create_client(
        self, api_key: str | None = None, base_url: str | None = None, **kwargs: Any
    ) -> Any:
        """Create a fail-fast client so model fallback is not hidden by SDK retries.

        The OpenAI-compatible SDK automatically retries rate limits and honours
        Groq's Retry-After header. On a voice call that can leave the caller in
        silence for 10-20 seconds before this service ever receives the 429.
        Fallback is the retry policy here, so the SDK itself must not retry.
        """
        client = super().create_client(api_key, base_url, **kwargs)
        return client.with_options(max_retries=0)

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._primary_model = self._settings.model
        self._backup_api_key = os.getenv("DOGRAH_GROQ_BACKUP_API_KEY", "").strip()
        self._backup_enabled = bool(
            self._backup_api_key and self._backup_api_key != kwargs.get("api_key")
        )
        if self._backup_api_key and not self._backup_enabled:
            logger.warning("Backup Groq API key matches the primary key; backup is disabled")
        if self._backup_enabled and self._primary_model != "openai/gpt-oss-120b":
            logger.warning(
                "Groq key fallback preserves the selected model {}; select "
                "openai/gpt-oss-120b in Dograh for the Sekol workflow",
                self._primary_model,
            )
        self._legacy_fallback_model = (
            os.getenv("DOGRAH_GROQ_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL).strip()
            or DEFAULT_FALLBACK_MODEL
        )
        self._fallback_active = (
            not self._backup_enabled
            and self._primary_model == self._legacy_fallback_model
        )
        self._fallback_lock = asyncio.Lock()
        self._retired_clients: list[Any] = []
        self._primary_requests = 0
        try:
            self._fallback_max_completion_tokens = max(
                256,
                int(
                    os.getenv(
                        "DOGRAH_GROQ_FALLBACK_MAX_COMPLETION_TOKENS",
                        str(DEFAULT_FALLBACK_MAX_COMPLETION_TOKENS),
                    )
                ),
            )
        except ValueError:
            self._fallback_max_completion_tokens = DEFAULT_FALLBACK_MAX_COMPLETION_TOKENS
        try:
            self._primary_request_limit = max(
                1, int(os.getenv("DOGRAH_GROQ_PRIMARY_MAX_REQUESTS", "3"))
            )
        except ValueError:
            self._primary_request_limit = 3
        try:
            self._groq_429_cooldown_seconds = max(
                0, int(os.getenv("DOGRAH_GROQ_429_COOLDOWN_SECONDS", "60"))
            )
        except ValueError:
            self._groq_429_cooldown_seconds = 60

    async def _set_fallback(self, reason: str) -> None:
        """Keep the conversation and model while switching Groq credentials."""
        async with self._fallback_lock:
            if self._fallback_active:
                return

            previous_client = self._client
            if self._backup_enabled:
                # Use the exact endpoint/model/settings from the active Groq
                # client. Only the credential changes; context is reused below.
                self._client = self.create_client(
                    api_key=self._backup_api_key,
                    base_url=str(previous_client.base_url),
                )
                fallback_model = self._primary_model
                provider_label = "backup Groq API key"
                self._retired_clients.append(previous_client)
            else:
                fallback_model = self._legacy_fallback_model
                provider_label = "Groq (legacy model fallback)"

            self._fallback_active = True
            self._settings.model = fallback_model
            # Keep enough completion budget for one compact appointment tool call.
            self._settings.max_completion_tokens = self._fallback_max_completion_tokens
            self._settings.extra = {
                **self._settings.extra,
                "reasoning_effort": "low",
                "parallel_tool_calls": False,
            }
            self.set_full_model_name(fallback_model)
            logger.warning(
                "Switching Groq from model {} to {} on model {} ({})",
                self._primary_model,
                provider_label,
                fallback_model,
                reason,
            )

    async def _apply_primary_budget_guard(self) -> None:
        if self._fallback_active:
            return
        if self._backup_enabled:
            cooldown_remaining = _groq_cooldown_remaining()
            if cooldown_remaining > 0:
                await self._set_fallback(
                    f"primary Groq key cooldown ({int(cooldown_remaining)}s remaining)"
                )
            # With a separate backup key, switch only for a real primary 429
            # (or another retryable API failure), not an arbitrary turn count.
            return
        if self._primary_requests >= self._primary_request_limit:
            await self._set_fallback(
                f"per-call primary request budget {self._primary_request_limit} reached"
            )
            return
        self._primary_requests += 1

    async def _activate_fallback(self, exc: Exception) -> bool:
        if not _is_retryable_model_error(exc):
            return False
        if self._backup_enabled and _status_code(exc) == 429:
            _start_groq_cooldown(self._groq_429_cooldown_seconds)

        await self._set_fallback(type(exc).__name__)
        return self._fallback_active

    async def get_chat_completions(self, context: Any) -> AsyncIterator[Any]:
        reinforce_transfer_decline_context(context)
        await self._apply_primary_budget_guard()
        request_started_on_fallback = self._fallback_active
        primary_stream = None
        try:
            primary_stream = await super().get_chat_completions(context)
        except Exception as exc:
            if request_started_on_fallback or not await self._activate_fallback(exc):
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
                    if (
                        emitted_output
                        or request_started_on_fallback
                        or not await self._activate_fallback(exc)
                    ):
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
        await self._apply_primary_budget_guard()
        request_started_on_fallback = self._fallback_active
        try:
            return await super().run_inference(
                context,
                max_tokens=max_tokens,
                system_instruction=system_instruction,
            )
        except Exception as exc:
            if request_started_on_fallback or not await self._activate_fallback(exc):
                raise
            return await super().run_inference(
                context,
                max_tokens=max_tokens,
                system_instruction=system_instruction,
            )

    async def cleanup(self) -> None:
        try:
            await super().cleanup()
        finally:
            # Keep the original connection alive while any already-started
            # primary request drains; close all clients only when the call ends.
            clients = [self._client, *self._retired_clients]
            self._retired_clients.clear()
            for client in clients:
                try:
                    await client.close()
                except Exception as exc:
                    logger.debug("Unable to close LLM client cleanly: {}", exc)
