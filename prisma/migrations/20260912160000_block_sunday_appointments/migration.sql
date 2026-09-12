ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_no_sunday_check"
CHECK (EXTRACT(DOW FROM "date") <> 0);
