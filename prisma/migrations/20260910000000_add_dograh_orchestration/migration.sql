ALTER TABLE "CallLog"
ADD COLUMN "dograhRunId" TEXT,
ADD COLUMN "recordingUrl" TEXT,
ADD COLUMN "transcriptUrl" TEXT;

CREATE UNIQUE INDEX "CallLog_dograhRunId_key" ON "CallLog"("dograhRunId");
