# Service notifications

The Calls dashboard shows a persistent notification banner across tabs. It lists
active incidents, acknowledged incidents and the latest 20 resolved incidents.
Details include service/component, reason, safe provider message, first/last
failure time in IST, number of affected call/check events, recent affected calls
and suggested action. Acknowledge does not clear an incident. Mark resolved is
an explicit operator confirmation after fixing/testing; a new failed call reopens
the incident. No calls, prompts, transfers or campaign scheduling are changed.

## Sources and limitations

- `service-monitor.mjs` reads structured Dograh runtime failures from Docker logs
  every five seconds and backfills recent runs using the existing Dograh API key.
  The dashboard refreshes every 15 seconds while visible. This is event-based
  monitoring, not a guarantee of provider availability.
- STT, TTS and LLM credit exhaustion, rate limits, credentials, timeouts and other
  provider failures are separate incidents. Ordinary busy/no-answer and SIP auth
  challenges do not become provider outages. Backfill covers the latest 20 runs
  created in the previous 24 hours; Docker logs cover current runtime failures.
- Repeated frames in the same call are deduplicated. This avoids thousands of
  alerts for the same Sarvam failure. The latest diagnostic is bounded/redacted;
  request bodies, keys and signed URLs are not displayed.
- Optional `VOBIZ_AUTH_ID` and `VOBIZ_AUTH_TOKEN` enable a read-only INR balance
  check every 60 seconds. Use credentials for the actual SIP trunk billing
  account. An explicit prepaid zero balance is critical; positive low balance
  uses the provider threshold (25 INR if absent). Postpaid debt alone is never
  reported as credit exhaustion. Verified positive prepaid balance can resolve
  the corresponding credit incident automatically.
- Without Vobiz API credentials, the dashboard explicitly says balance is not
  connected; observed runtime failures can still be shown. Exact Sarvam credit
  balance is not queried. Its exhaustion alerts come from actual API failures.
- Monitor heartbeat older than 45 seconds or failed log access shows monitoring
  unavailable. An empty alert list means no unresolved failures were reported,
  not that all credits/providers were verified healthy.

Provider contracts: [Vobiz balance](https://www.vobiz.ai/docs/account/balance),
[Sarvam error codes](https://docs.sarvam.ai/api/getting-started/errors-troubleshooting).
Sarvam can report credit exhaustion as `insufficient_quota_error`/429 or a
WebSocket closure; newer billing APIs also use 402. Rate limits are classified
separately from explicit credit errors.

## Deployment

Deploy the reviewed commit, then run:

```sh
npm run db:migrate
npm run db:generate
node --test tests/service-alerts.test.mjs tests/service-alerts-api.test.mjs
npm run build
pm2 restart sekol-crm --update-env
pm2 start npm --name sekol-service-monitor -- run service:monitor
pm2 save
```

For later releases, restart the existing `sekol-service-monitor` process instead
of creating another. Run a single monitor instance. The Ubuntu service user
needs Docker log-read access (`docker` group on this VPS). Override
`DOGRAH_MONITOR_CONTAINER` if the API container name differs from `dograh-api-1`.
No Dograh/Asterisk restart is required. The monitor never places a call or
submits paid STT/TTS/LLM test requests; its Vobiz balance check is read-only.

Migration `20261015000000_add_service_alerts` creates three additive tables;
existing calls and campaigns are preserved. If rolling back the app, stop the
monitor and leave those tables for audit history. Never include unrelated
pending disconnect-audit changes in this deployment.
