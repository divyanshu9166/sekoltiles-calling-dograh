ALTER TABLE "Appointment" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CallLog" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CallLog" ADD COLUMN "transcriptDeletedAt" TIMESTAMP(3);
ALTER TABLE "CatalogueRequest" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE TABLE "PhoneBookEntry" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneBookEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PhoneBookEntry_phone_key" ON "PhoneBookEntry"("phone");
CREATE INDEX "PhoneBookEntry_archivedAt_updatedAt_idx" ON "PhoneBookEntry"("archivedAt", "updatedAt");
CREATE INDEX "Appointment_deletedAt_idx" ON "Appointment"("deletedAt");
CREATE INDEX "CallLog_deletedAt_idx" ON "CallLog"("deletedAt");
CREATE INDEX "CatalogueRequest_deletedAt_idx" ON "CatalogueRequest"("deletedAt");
