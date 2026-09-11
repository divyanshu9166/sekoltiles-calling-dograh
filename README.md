# Autozentic AI Calling Agent

This folder is the Sekol Tiles calling CRM. Dograh is the voice orchestration layer and connects directly to Vobiz for telephony. The CRM triggers published Dograh workflows, keeps its own call records, receives post-call results by webhook, and can use a Dograh headless voice widget for browser test calls.

The `/calls` page includes a database-backed **Appointments** tab. Appointments created by the Python calling agent through `/api/appointments/create` and appointments entered manually in the UI use the same Prisma `Appointment` table.

## Setup

1. Review `.env`. It was copied from the working Tiles CRM so the extracted system uses the same configured services and PostgreSQL database.
2. Install the web dependencies:
   `npm install`
3. Generate the Prisma client:
   `npm run db:generate`
4. For a fresh PostgreSQL database, create the tables with:
   `npm run db:migrate`
5. Start the web application:
   `npm run dev`

Open [http://localhost:3000/calls](http://localhost:3000/calls).

## Required environment variables

- `DATABASE_URL`
- `CRM_API_URL=http://localhost:3000`
- `CRM_API_SECRET`
- `DOGRAH_API_URL` — public URL of the self-hosted Dograh instance
- `DOGRAH_API_KEY` — create this under Dograh Settings → API Keys
- `DOGRAH_WORKFLOW_UUID` — stable UUID of the published Sekol workflow
- `NEXT_PUBLIC_DOGRAH_WIDGET_URL` — optional headless voice-widget script URL

Configure Vobiz inside Dograh, mark it as the default outbound configuration, add the caller number, and publish the workflow. For post-call CRM sync, add a final Dograh Webhook node:

- Endpoint: `https://YOUR_CRM/api/calls/dograh-webhook`
- Header: `X-API-Secret: <CRM_API_SECRET>`
- Payload fields: `run_id`, `initial_context`, `gathered_context`, `call_status`, `call_disposition`, `duration`, `recording_url`, `transcript_url`, and optionally `transcript`, `summary`, `sentiment`

The former `ai-agent/` directory is retained only as migration reference. It is not part of the active Dograh runtime.

## VPS sizing

Dograh officially recommends 8 GB RAM and 4 vCPU for a remote deployment. A 4 GB pilot can be attempted with `FASTAPI_WORKERS=1` and `ARQ_WORKERS=1`, external/BYOK LLM-STT-TTS providers, and low concurrency, but it should not be treated as the production capacity target. Monitor container memory and upgrade before enabling campaigns or multiple simultaneous calls.

Keep `.env` private. It is excluded by this folder's `.gitignore`.
