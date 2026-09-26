"""Offline checks for switching Groq credentials during a live call."""

import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class RateLimitError(Exception):
    status_code = 429


class FakeClient:
    def __init__(self, api_key, base_url):
        self.api_key = api_key
        self.base_url = base_url or "https://api.groq.com/openai/v1/"
        self.closed = False

    def with_options(self, **_kwargs):
        return self

    async def close(self):
        self.closed = True


class FakeGroqLLMService:
    def __init__(self, *, api_key, settings=None, **_kwargs):
        self._settings = settings or types.SimpleNamespace(
            model="openai/gpt-oss-120b",
            extra={},
            max_completion_tokens=384,
        )
        self._client = self.create_client(api_key)
        self.requests = []

    def create_client(self, api_key=None, base_url=None, **_kwargs):
        return FakeClient(api_key, base_url)

    def set_full_model_name(self, _model):
        pass

    async def get_chat_completions(self, context):
        self.requests.append((self._client.api_key, self._settings.model, context))
        if self._client.api_key == "primary":
            raise RateLimitError("Groq TPM exhausted")

        async def chunks():
            yield "reply"

        return chunks()

    async def run_inference(self, context, **_kwargs):
        self.requests.append((self._client.api_key, self._settings.model, context))
        if self._client.api_key == "primary":
            raise RateLimitError("Groq TPM exhausted")
        return "reply"

    async def cleanup(self):
        pass


def import_fallback():
    modules = {
        "loguru": types.ModuleType("loguru"),
        "pipecat": types.ModuleType("pipecat"),
        "pipecat.services": types.ModuleType("pipecat.services"),
        "pipecat.services.groq": types.ModuleType("pipecat.services.groq"),
        "pipecat.services.groq.llm": types.ModuleType("pipecat.services.groq.llm"),
        "api": types.ModuleType("api"),
        "api.services": types.ModuleType("api.services"),
        "api.services.workflow": types.ModuleType("api.services.workflow"),
        "api.services.workflow.transfer_consent_guard": types.ModuleType(
            "api.services.workflow.transfer_consent_guard"
        ),
    }
    modules["loguru"].logger = types.SimpleNamespace(
        warning=lambda *_args: None,
        debug=lambda *_args: None,
    )
    modules["pipecat.services.groq.llm"].GroqLLMService = FakeGroqLLMService
    modules[
        "api.services.workflow.transfer_consent_guard"
    ].reinforce_transfer_decline_context = lambda _context: None
    source = Path(__file__).resolve().parents[1] / "deploy/dograh/groq_model_fallback.py"
    spec = importlib.util.spec_from_file_location("sekol_groq_fallback_test", source)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


class GroqKeyFallbackTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(
            os.environ,
            {
                "DOGRAH_GROQ_BACKUP_API_KEY": "backup",
                "DOGRAH_GROQ_429_COOLDOWN_SECONDS": "60",
            },
        )
        self.env.start()
        self.module = import_fallback()

    async def asyncTearDown(self):
        self.env.stop()

    async def test_stream_retries_with_same_model_and_same_context(self):
        context = object()
        service = self.module.FallbackGroqLLMService(api_key="primary")

        stream = await service.get_chat_completions(context)
        self.assertEqual([part async for part in stream], ["reply"])
        self.assertEqual(
            service.requests,
            [
                ("primary", "openai/gpt-oss-120b", context),
                ("backup", "openai/gpt-oss-120b", context),
            ],
        )
        self.assertTrue(service._fallback_active)
        await service.cleanup()
        self.assertTrue(service._client.closed)

    async def test_next_call_uses_backup_during_primary_cooldown(self):
        first = self.module.FallbackGroqLLMService(api_key="primary")
        await first.run_inference(object())

        second = self.module.FallbackGroqLLMService(api_key="primary")
        context = object()
        self.assertEqual(await second.run_inference(context), "reply")
        self.assertEqual(
            second.requests,
            [("backup", "openai/gpt-oss-120b", context)],
        )
        await first.cleanup()
        await second.cleanup()


if __name__ == "__main__":
    unittest.main()
