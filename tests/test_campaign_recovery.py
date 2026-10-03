import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase, main
from unittest.mock import AsyncMock


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / "deploy/dograh" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


recovery = load("campaign_recovery")
installer = load("install_campaign_recovery")


class RecoveryTests(IsolatedAsyncioTestCase):
    def setUp(self):
        self.run = SimpleNamespace(
            id=42, mode="ari", state="initialized", is_completed=False,
            initial_context={"source": "sekol-bulk-campaign"},
            gathered_context={"call_id": "caller-42"},
            created_at=datetime.now(timezone.utc) - timedelta(seconds=60),
        )
        self.channels = AsyncMock(return_value=[])
        self.release = AsyncMock()
        self.update = AsyncMock()

    async def reconcile(self):
        return await recovery.reconcile_campaign_run(
            self.run, list_channels=self.channels, release_slot=self.release, update_run=self.update,
        )

    async def test_absent_channel_releases_slot_and_completes_run_idempotently(self):
        result = await self.reconcile()
        self.assertEqual(result["status"], "recovered")
        self.release.assert_awaited_once_with(42)
        self.assertTrue(self.update.call_args.kwargs["is_completed"])
        self.assertEqual(self.update.call_args.kwargs["gathered_context"]["campaign_recovery"], "ari_channel_confirmed_gone")
        self.run.is_completed = True
        self.update.reset_mock()
        self.assertEqual((await self.reconcile())["status"], "completed")
        self.update.assert_not_awaited()

    async def test_ringing_and_answered_channels_are_never_released(self):
        for state in ["Down", "Ringing", "Up"]:
            self.channels.return_value = [{"id": "caller-42", "state": state}]
            self.assertEqual((await self.reconcile())["status"], "active")
        self.release.assert_not_awaited()
        self.update.assert_not_awaited()

    async def test_transfer_peer_is_also_protected(self):
        self.run.gathered_context["transfer_destination_channel_id"] = "human-42"
        self.channels.return_value = [{"id": "human-42"}]
        self.assertEqual((await self.reconcile())["status"], "active")
        self.release.assert_not_awaited()

    async def test_network_or_bad_payload_is_not_evidence_of_hangup(self):
        self.channels.side_effect = TimeoutError("ARI offline")
        with self.assertRaises(TimeoutError):
            await self.reconcile()
        self.channels.side_effect = None
        self.channels.return_value = {"error": "auth failed"}
        with self.assertRaises(ValueError):
            await self.reconcile()
        self.release.assert_not_awaited()
        self.update.assert_not_awaited()

    async def test_slot_cleanup_failure_does_not_mark_run_finished(self):
        self.release.side_effect = RuntimeError("Redis unavailable")
        with self.assertRaises(RuntimeError):
            await self.reconcile()
        self.update.assert_not_awaited()

    async def test_pipeline_finalization_is_not_overwritten(self):
        self.run.gathered_context["ext_channel_id"] = "media-42"
        self.assertEqual((await self.reconcile())["status"], "awaiting_finalization")
        self.release.assert_not_awaited()
        self.update.assert_not_awaited()

    async def test_unrelated_and_just_created_runs_are_untouched(self):
        self.run.initial_context = {"source": "manual"}
        self.assertEqual((await self.reconcile())["status"], "not_supported")
        self.run.initial_context = {"source": "sekol-bulk-campaign"}
        self.run.created_at = datetime.now(timezone.utc)
        self.assertEqual((await self.reconcile())["status"], "not_ready")
        self.channels.assert_not_awaited()
        self.update.assert_not_awaited()


class InstallerTests(TestCase):
    def test_idempotent_install_and_reject_unknown_version(self):
        source = 'router = APIRouter(prefix="/public/agent")\nasync def _validate_api_key(key): pass\n'
        patched = installer.patched_source(source)
        self.assertEqual(installer.patched_source(patched), patched)
        with self.assertRaises(RuntimeError):
            installer.patched_source("unrelated = True\n")


if __name__ == "__main__":
    main()
