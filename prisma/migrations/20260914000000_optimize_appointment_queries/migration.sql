-- Keep caller lookup and daily availability checks fast as appointment volume grows.
CREATE INDEX "Appointment_contactId_status_date_idx"
ON "Appointment"("contactId", "status", "date");

CREATE INDEX "Appointment_date_status_idx"
ON "Appointment"("date", "status");
