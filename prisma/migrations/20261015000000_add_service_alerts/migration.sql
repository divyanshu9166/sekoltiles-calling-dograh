CREATE TABLE "ServiceAlert" (
  "id" SERIAL PRIMARY KEY, "fingerprint" TEXT NOT NULL UNIQUE,
  "service" TEXT NOT NULL, "component" TEXT NOT NULL, "code" TEXT NOT NULL,
  "severity" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL, "message" TEXT NOT NULL, "action" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL, "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedAt" TIMESTAMP(3), "resolvedAt" TIMESTAMP(3),
  "occurrences" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "ServiceAlert_status_lastSeenAt_idx" ON "ServiceAlert"("status", "lastSeenAt");
CREATE TABLE "ServiceAlertEvent" (
  "id" SERIAL PRIMARY KEY, "eventKey" TEXT NOT NULL UNIQUE,
  "alertId" INTEGER NOT NULL REFERENCES "ServiceAlert"("id") ON DELETE CASCADE,
  "runId" TEXT, "observedAt" TIMESTAMP(3) NOT NULL, "message" TEXT NOT NULL
);
CREATE INDEX "ServiceAlertEvent_alertId_observedAt_idx" ON "ServiceAlertEvent"("alertId", "observedAt");
CREATE TABLE "ServiceMonitorState" (
  "id" TEXT PRIMARY KEY, "heartbeatAt" TIMESTAMP(3) NOT NULL,
  "cursor" TIMESTAMP(3), "details" JSONB NOT NULL
);
