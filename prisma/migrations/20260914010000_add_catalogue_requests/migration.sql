CREATE TABLE "CatalogueRequest" (
    "id" SERIAL NOT NULL,
    "callLogId" INTEGER NOT NULL,
    "customer" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "region" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogueRequest_callLogId_key" ON "CatalogueRequest"("callLogId");
CREATE INDEX "CatalogueRequest_requestedAt_idx" ON "CatalogueRequest"("requestedAt");

ALTER TABLE "CatalogueRequest"
ADD CONSTRAINT "CatalogueRequest_callLogId_fkey"
FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
