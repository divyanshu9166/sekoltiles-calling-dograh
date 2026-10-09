ALTER TABLE "MarketingCampaign"
ADD COLUMN "callingStartTime" VARCHAR(5),
ADD COLUMN "callingEndTime" VARCHAR(5),
ADD COLUMN "autoResumeDaily" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "scheduleStopAt" TIMESTAMP(3);

ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_calling_window_check"
CHECK (
  ("callingStartTime" IS NULL AND "callingEndTime" IS NULL)
  OR (
    "callingStartTime" IS NOT NULL AND "callingEndTime" IS NOT NULL
    AND "callingStartTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "callingEndTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "callingStartTime" < "callingEndTime"
  )
);
