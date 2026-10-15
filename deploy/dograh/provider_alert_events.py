"""Send a bounded, non-blocking notification ONLY when a provider reports error.

No polling, balance requests, history scans, startup tasks or idle timers.
"""
import asyncio
import os
import time
from collections import OrderedDict
from datetime import datetime, timezone

import httpx

_seen = OrderedDict()
_pending = set()


def _value(value):
    return str(getattr(value, "value", value) or "")


def notification_payload(failure, context, run_id=None):
    source = _value(failure.source)
    if source not in {"stt", "tts", "llm", "telephony"}:
        return None
    identifier = str(context.get("workflow_run_id") or context.get("run_id") or run_id or "")
    return {
        "source": source,
        "provider": _value(failure.provider) or str(failure.code).split("-")[0],
        "code": str(failure.code)[:100],
        # Dograh's failure classifier already redacts credentials.
        "message": str(failure.internal_message)[:4000],
        "runId": identifier if identifier.isdecimal() else "",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def _deliver(payload, url, secret):
    # Retries exist only for an actual error notification and are bounded.
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(2.0, connect=1.0)) as client:
            for attempt in range(3):
                try:
                    response = await client.post(url, json=payload, headers={"x-sekol-alert-secret": secret})
                    if response.status_code < 500:
                        return
                except (httpx.HTTPError, OSError):
                    pass
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
    except Exception:
        # Notification delivery can never break or recurse into call processing.
        pass


def notify_provider_failure(failure, context):
    try:
        url = os.getenv("SEKOL_ALERT_EVENT_URL", "")
        secret = os.getenv("SEKOL_ALERT_SECRET", "")
        if not url or not secret or len(_pending) >= 8:
            return
        from pipecat.utils.run_context import get_current_run_id
        payload = notification_payload(failure, context, get_current_run_id())
        if payload is None:
            return
        # Provider error storms must not create extra work on every audio frame.
        key = (payload["source"], payload["provider"], payload["code"], payload["runId"])
        now = time.monotonic()
        if now - _seen.get(key, -1000) < 300:
            return
        loop = asyncio.get_running_loop()
        _seen[key] = now
        _seen.move_to_end(key)
        while len(_seen) > 256:
            _seen.popitem(last=False)
        task = loop.create_task(_deliver(payload, url, secret))
        _pending.add(task)
        task.add_done_callback(_pending.discard)
    except Exception:
        pass
