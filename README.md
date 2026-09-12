# Autozentic AI Calling Agent

This folder is the Sekol Tiles calling CRM. Dograh is the voice orchestration layer and connects directly to Vobiz for telephony. The CRM triggers published Dograh workflows, keeps its own call records, receives post-call results by webhook, and can use a Dograh headless voice widget for browser test calls.

The `/calls` page includes a database-backed **Appointments** tab. Appointments created by Dograh through `/api/appointments/create` and appointments entered manually in the UI use the same Prisma `Appointment` table.

## Setup

1. Create a dedicated PostgreSQL database for this project and review `.env`.
   Do not reuse the Tiles CRM database or its credentials.
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
- `CRM_PUBLIC_URL` — public HTTPS CRM origin reachable from Dograh, for example `https://crm.example.com`
- `CRM_API_SECRET`
- `DOGRAH_API_URL` — public URL of the self-hosted Dograh instance
- `DOGRAH_API_KEY` — create this under Dograh Settings → API Keys
- `DOGRAH_WORKFLOW_UUID` — stable UUID of the published Sekol workflow
- `NEXT_PUBLIC_DOGRAH_WIDGET_URL` — optional headless voice-widget script URL

Configure Vobiz inside Dograh, mark it as the default outbound configuration, and add the caller number. Then publish the version-controlled Sekol prompt, appointment tools, end-call tool, and transcript webhook with:

`npm run dograh:sync`

The command is idempotent and preserves the model and telephony settings selected in Dograh. The CRM also reconciles recent Dograh run details when call logs load, so a delayed or missed webhook cannot permanently hide a transcript or final call status.

LiveKit is not part of this project. Voice orchestration is exclusively handled by the separately deployed Dograh instance.

For the VPS deployment, copy `deploy/dograh/docker-compose.override.yaml` beside
Dograh's generated `docker-compose.yaml`, validate it with `docker compose config`,
and recreate the Dograh API service. The override gives Dograh access to the CRM
through the Linux host gateway and applies the Groq Qwen completion limit used by
the published Sekol workflow. Provider credentials remain in Dograh's dashboard
and must never be committed to this repository.

## VPS sizing

Dograh officially recommends 8 GB RAM and 4 vCPU for a remote deployment. A 4 GB pilot can be attempted with `FASTAPI_WORKERS=1` and `ARQ_WORKERS=1`, external/BYOK LLM-STT-TTS providers, and low concurrency, but it should not be treated as the production capacity target. Monitor container memory and upgrade before enabling campaigns or multiple simultaneous calls.

Keep `.env` private. It is excluded by this folder's `.gitignore`.
