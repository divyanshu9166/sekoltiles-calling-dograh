import asyncio
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "deploy" / "dograh" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeClient:
    requests = []

    def __init__(self, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def post(self, url, **kwargs):
        self.requests.append(kwargs["json"])
        return types.SimpleNamespace(status_code=200)


class EventReporterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        FakeClient.requests = []
        self.dependencies = patch.dict(sys.modules, {
            "httpx": types.SimpleNamespace(AsyncClient=FakeClient, Timeout=lambda *a, **k: None, HTTPError=RuntimeError),
            "pipecat.utils.run_context": types.SimpleNamespace(get_current_run_id=lambda: 5463),
        })
        self.dependencies.start()
        self.env = patch.dict("os.environ", {"SEKOL_ALERT_EVENT_URL": "http://crm.invalid/events", "SEKOL_ALERT_SECRET": "test-only"})
        self.env.start()
        self.reporter = load("provider_alert_events")
        self.failure = types.SimpleNamespace(source="stt", provider="sarvam", code="sarvam-connection", internal_message="Credits exhausted")

    async def asyncTearDown(self):
        if self.reporter._pending:
            await asyncio.gather(*self.reporter._pending)
        self.env.stop()
        self.dependencies.stop()

    async def test_idle_creates_no_work_or_timers(self):
        await asyncio.sleep(0)
        self.assertEqual(self.reporter._pending, set())
        self.assertEqual(len(self.reporter._seen), 0)
        self.assertEqual(FakeClient.requests, [])
        self.assertNotIn("setInterval", (ROOT / "components/ServiceAlerts.jsx").read_text(encoding="utf8"))
        self.assertFalse((ROOT / "scripts/service-monitor.mjs").exists())

    async def test_error_storm_sends_one_nonblocking_notification(self):
        for _ in range(1000):
            self.reporter.notify_provider_failure(self.failure, {})
        self.assertEqual(len(self.reporter._pending), 1)
        self.assertEqual(FakeClient.requests, [])  # original call path never awaited HTTP
        await asyncio.gather(*self.reporter._pending)
        self.assertEqual(len(FakeClient.requests), 1)
        self.assertEqual(FakeClient.requests[0]["runId"], "5463")

    async def test_unrelated_errors_and_unconfigured_reporting_are_ignored(self):
        self.failure.source = "webhook"
        self.reporter.notify_provider_failure(self.failure, {})
        self.assertEqual(self.reporter._pending, set())

    async def test_missing_async_context_cannot_raise_into_call_processing(self):
        # Classification/reporting errors must not alter the original provider path.
        self.reporter.notify_provider_failure(object(), {})
        self.assertEqual(self.reporter._pending, set())


class InstallerTests(unittest.TestCase):
    def test_hook_is_exact_idempotent_and_rejects_unknown_sources(self):
        installer = load("install_provider_alert_events")
        original = 'def log_failure(failure, **extra_context):\n    try:\n' + installer.ANCHOR + '    except Exception:\n        return\n'
        changed = installer.patched_source(original)
        self.assertEqual(installer.patched_source(changed), changed)
        self.assertEqual(changed.count("notify_provider_failure(failure, context)"), 1)
        with self.assertRaises(RuntimeError):
            installer.patched_source("def other(): pass")


if __name__ == "__main__":
    unittest.main()
