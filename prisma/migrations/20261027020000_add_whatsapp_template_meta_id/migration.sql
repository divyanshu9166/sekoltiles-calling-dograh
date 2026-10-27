-- Meta's ID for a message template, saved when the CRM submits it for review
-- or syncs it from WhatsApp Manager.
ALTER TABLE "message_templates" ADD COLUMN "meta_template_id" TEXT;
