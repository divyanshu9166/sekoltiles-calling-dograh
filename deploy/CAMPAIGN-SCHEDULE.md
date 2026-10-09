# Bulk campaign calling hours

Campaign creation and editing support start/end times in Asia/Kolkata (IST),
independent of the browser or server timezone. New forms suggest 10:00–17:00,
with automatic next-day resume off. Existing campaigns remain unrestricted
until a user enables calling hours and saves the settings.

- The start time is inclusive; the end time is exclusive. Both must be on the
  same day, with the end later than the start.
- Only initiation of new outbound campaign calls is gated. An ongoing call is
  never disconnected by the schedule. Normal call reconciliation still runs.
- Automatic next-day resume on: pending leads wait for the next daily window.
- Automatic next-day resume off: after closing and any active call completes,
  the campaign pauses until the user clicks Resume.
- Start/Resume before opening waits for today's opening. Start/Resume after
  closing arms the next day's window. Explicit Pause overrides automatic resume.
- A persisted manual deadline prevents an offline/restarted worker from
  accidentally continuing a manual campaign the next day.
- Completed campaigns do not reopen automatically. Failed-contact retries use
  the same schedule. Existing inter-call gaps and capacity recovery still apply.

## Deployment prerequisite

Apply migration `20261009000000_add_campaign_calling_schedule` before restarting
the updated CRM or worker. It adds four columns and a time validation constraint;
it does not delete data or enable schedules on existing campaigns.

After transferring the reviewed schedule changes to the VPS project directory:

```sh
npm run db:migrate
npm run db:generate
npm run build
```

Only if all three commands succeed, restart `sekol-crm` and
`sekol-campaign-worker` with PM2. No Asterisk or Dograh restart is required.
Do not bundle unrelated pending disconnect-audit changes into this deployment.

## Local verification

```sh
node --test tests/campaign-schedule.test.mjs tests/campaign-schedule-api.test.mjs tests/campaign-run-recovery.test.mjs
node --check scripts/campaign-worker.mjs
npx tsc --noEmit
npm run build
```

The schedule tests use an isolated clock and mocked database/provider; they
cannot initiate real calls. They cover 16:59 calls finishing after 17:00,
manual/automatic resume, claim-to-dial cutoff races, persisted deadlines,
custom times, disabled schedules, validation and authentication.
