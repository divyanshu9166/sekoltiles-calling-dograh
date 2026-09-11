CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "CallStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'FAILED', 'COMPLETED', 'MISSED', 'NO_ANSWER', 'BUSY');

CREATE TABLE "Contact" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL UNIQUE,
  "email" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Appointment" (
  "id" SERIAL PRIMARY KEY,
  "contactId" INTEGER NOT NULL REFERENCES "Contact"("id"),
  "date" TIMESTAMP(3) NOT NULL,
  "time" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Scheduled',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "CallLog" (
  "id" SERIAL PRIMARY KEY,
  "contactId" INTEGER REFERENCES "Contact"("id"),
  "customerName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "direction" "CallDirection" NOT NULL,
  "status" "CallStatus" NOT NULL,
  "duration" TEXT,
  "durationSec" INTEGER NOT NULL DEFAULT 0,
  "agent" TEXT NOT NULL DEFAULT 'AI Agent',
  "date" TIMESTAMP(3) NOT NULL,
  "time" TEXT NOT NULL,
  "purpose" TEXT,
  "outcome" TEXT,
  "notes" TEXT,
  "recording" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "livekitRoomId" TEXT UNIQUE,
  "callType" TEXT DEFAULT 'manual',
  "aiHandled" BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE "CallTranscript" (
  "id" SERIAL PRIMARY KEY,
  "callLogId" INTEGER NOT NULL UNIQUE REFERENCES "CallLog"("id") ON DELETE CASCADE,
  "summary" TEXT,
  "sentiment" TEXT,
  "messages" JSONB NOT NULL
);

CREATE INDEX "Appointment_date_idx" ON "Appointment"("date");
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");
CREATE UNIQUE INDEX "Appointment_date_time_key" ON "Appointment"("date", "time");
CREATE INDEX "CallLog_date_idx" ON "CallLog"("date");
CREATE INDEX "CallLog_contactId_idx" ON "CallLog"("contactId");
