# Campaign call recovery

The CRM checks unresolved ARI campaign runs after 40 seconds. It must not
advance the queue based on elapsed time alone: the Dograh run owns a concurrency
slot independently of the CRM lead.

`campaign_recovery.py` installs an API-key authenticated, organization-scoped
`POST /api/v1/public/agent/runs/{run_id}/reconcile` endpoint. It only handles
ARI runs whose initial source is `sekol-bulk-campaign`.

It queries Asterisk's current channels, preserves any caller/media/transfer
channel still present, and leaves conversation finalization to the existing
pipeline. For an ended pre-media call, it releases the run's concurrency slot,
verifies removal, and marks the run completed/failed. ARI, authentication, and
Redis failures keep the CRM queue blocked instead of declaring a false hangup.
It never hangs up a channel or changes the concurrency limit.

Deploy the two Python files and the committed compose override into the Dograh
directory. Recreate the API service only when no calls are active, then deploy
the matching CRM worker. The worker requires this endpoint; a missing endpoint
causes retries without advancing the queue. Existing authenticated run retrieval
remains unchanged. No schema migration or workflow/prompt synchronization is
required.

The worker treats Dograh's explicit `429 / Concurrent call limit reached` as a
temporary capacity rejection. It requeues the same lead, reuses its call log,
and waits 40 seconds. Other errors keep their existing handling.

Checks:

```sh
node --test tests/campaign-run-recovery.test.mjs
python -m unittest discover -s tests -p test_campaign_recovery.py
```
