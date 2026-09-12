-- Cancelled appointments must not permanently block a showroom slot.
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_date_time_key";
DROP INDEX IF EXISTS "Appointment_date_time_key";

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "region" TEXT;

CREATE INDEX IF NOT EXISTS "Appointment_date_time_idx" ON "Appointment"("date", "time");
