# Event-triggered service alerts

Provider alerts are emitted ONLY from Dograh's existing failure logger, after
an actual STT, TTS, LLM or telephony error. There are no background provider
probes, Docker log readers, balance checks, call-history scans, monitor daemon,
heartbeat writes or notification polling loops.

The hook schedules a small asynchronous POST without awaiting it in the voice
pipeline. It deduplicates each source/provider/code/run for five minutes, bounds
its cache at 256 keys and pending sends at eight, and retries at most three times
only after a real error. Reporting failures never raise into call processing.
Idle operation creates no reporting tasks or timers.

The authenticated dashboard uses a passive SSE connection while visible. New
events invalidate its saved alert view. It closes the connection when hidden;
it does not poll the database or any provider. Native SSE reconnects can occur
if the connection drops. The single PM2 CRM process shares the event bus; a
multi-process deployment would need shared pub/sub instead.

Existing alerts, affected-call counts, acknowledge and resolved history remain.
"Error reporting configured" describes setup, not provider health. No errors
reported does not verify balances. Vobiz exhaustion can only be identified if
the provider reports a credit/payment error; generic rejection is not proof of
zero balance. There are no proactive low-balance alerts in this mode.

## Deployment

1. Set random shared `SEKOL_ALERT_SECRET` in CRM and Dograh environments. Set
   Dograh `SEKOL_ALERT_EVENT_URL` to the CRM `/api/service-alerts/events` endpoint
   using the private network or HTTPS. Ingestion rejects missing secrets, old
   timestamps and payloads over 16 KB. Diagnostics are redacted before storage.
2. Copy `provider_alert_events.py`, `install_provider_alert_events.py` and the
   reviewed compose override beside Dograh compose. Do not include unrelated
   pending disconnect-audit changes. The installer validates the existing logger
   anchor and is idempotent.
3. Build/restart CRM. Recreate Dograh API only with no active calls to install the
   hook. Do not change voice models, prompts, transfer or campaign settings.
4. Remove the old polling daemon:

```sh
pm2 delete sekol-service-monitor
pm2 save
```

5. Mark `ServiceMonitorState.providers.details` as
   `{ "mode": "EVENT_DRIVEN", "enabled": true }` after verifying the hook and
   authenticated delivery. Its timestamp tracks received errors, not heartbeat.
   Keep all existing alert tables/history; no new migration is needed.

Verify event ingestion, rejected unauthorized requests, live SSE updates,
unchanged idle DB/provider activity, duplicate suppression and no reporter
timers/tasks before an actual error. Delivery is bounded best effort: if CRM
stays unavailable beyond retries, errors remain in normal Dograh logs but no
permanent recovery worker is started.
