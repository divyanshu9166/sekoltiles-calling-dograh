CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED');
CREATE TYPE "CampaignLeadStatus" AS ENUM ('PENDING', 'CALLING', 'COMPLETED', 'FAILED', 'SKIPPED');

CREATE TABLE "MarketingCampaign" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT,
    "interCallDelaySec" INTEGER NOT NULL DEFAULT 15,
    "nextCallAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignLead" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "region" TEXT,
    "status" "CampaignLeadStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "callLogId" INTEGER,
    "dograhRunId" TEXT,
    "outcome" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingCampaign_status_createdAt_idx" ON "MarketingCampaign"("status", "createdAt");
CREATE INDEX "CampaignLead_campaignId_status_id_idx" ON "CampaignLead"("campaignId", "status", "id");
CREATE INDEX "CampaignLead_dograhRunId_idx" ON "CampaignLead"("dograhRunId");
CREATE UNIQUE INDEX "CampaignLead_campaignId_phone_key" ON "CampaignLead"("campaignId", "phone");

ALTER TABLE "CampaignLead"
ADD CONSTRAINT "CampaignLead_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
