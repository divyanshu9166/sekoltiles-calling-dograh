"""Reconcile abandoned Sekol campaign calls against the actual ARI channels.

ARI calls which never enter Stasis don't reach the normal pipeline teardown.
The CRM must release their Dograh slot as well as its own queue entry. No
channel is hung up by this module, and answered calls retain normal teardown.
"""
from datetime import datetime, timezone


async def reconcile_campaign_run(run, *, list_channels, release_slot, update_run):
    initial = run.initial_context or {}
    context = run.gathered_context or {}
    if run.mode != "ari" or initial.get("source") != "sekol-bulk-campaign":
        return {"status": "not_supported"}
    age = (datetime.now(timezone.utc) - run.created_at).total_seconds()
    if age < 40 or not context.get("call_id"):
        return {"status": "not_ready"}

    # Network/auth failures must raise, never masquerade as an empty channel list.
    channels = await list_channels()
    if not isinstance(channels, list) or any(not isinstance(c, dict) or not c.get("id") for c in channels):
        raise ValueError("Invalid ARI channel list")
    live_ids = {channel["id"] for channel in channels}
    related_ids = {
        context.get(key) for key in (
            "call_id", "ext_channel_id", "transfer_caller_channel_id",
            "transfer_destination_channel_id",
        ) if context.get(key)
    }
    if live_ids & related_ids:
        return {"status": "active"}
    # Don't invent a result for a conversation whose pipeline is still saving
    # its transcript/disposition. This recovery handles pre-media failures only.
    if not run.is_completed and (context.get("ext_channel_id") or context.get("bridge_id") or run.state == "running"):
        return {"status": "awaiting_finalization"}

    # Release first: if Redis fails, do not claim completion and advance the queue.
    await release_slot(run.id)
    if run.is_completed:
        return {"status": "completed"}
    await update_run(
        run_id=run.id, is_completed=True, state="completed",
        gathered_context={
            "call_status": "failed", "call_disposition": "failed",
            "mapped_call_disposition": "failed",
            "error": "ARI channel ended before the media pipeline started",
            "campaign_recovery": "ari_channel_confirmed_gone",
        },
    )
    return {"status": "recovered"}


def install_campaign_recovery_routes(router, validate_api_key):
    import aiohttp
    from fastapi import Header, HTTPException
    from api.db import db_client
    from api.services.call_concurrency import call_concurrency
    from api.services.call_concurrency.rate_limiter import rate_limiter
    from api.services.telephony.factory import get_telephony_provider_for_run

    @router.post("/runs/{run_id}/reconcile")
    async def reconcile(run_id: int, x_api_key: str = Header(...)):
        key = await validate_api_key(x_api_key)
        if not key.organization_id:
            raise HTTPException(status_code=403, detail="Organization required")
        run = await db_client.get_workflow_run(run_id, organization_id=key.organization_id)
        if not run:
            raise HTTPException(status_code=404, detail="Workflow run not found")
        if run.mode != "ari" or (run.initial_context or {}).get("source") != "sekol-bulk-campaign":
            return {"status": "not_supported"}
        provider = await get_telephony_provider_for_run(run, key.organization_id)

        async def list_channels():
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
                async with session.get(f"{provider.base_url}/channels", auth=provider._get_auth()) as response:
                    response.raise_for_status()
                    return await response.json()

        async def release_slot(run_id):
            await call_concurrency.release_workflow_run_slot(run_id)
            redis = await rate_limiter._get_redis()
            if await redis.exists(f"workflow_slot_mapping:{run_id}"):
                raise RuntimeError("Call slot release is not confirmed")

        try:
            return await reconcile_campaign_run(
                run, list_channels=list_channels, release_slot=release_slot,
                update_run=db_client.update_workflow_run,
            )
        except Exception as error:
            raise HTTPException(status_code=503, detail="Campaign call recovery could not be verified; retry later") from error
