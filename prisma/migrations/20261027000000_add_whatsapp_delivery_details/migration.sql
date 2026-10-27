-- Why an outgoing WhatsApp message failed, marketing opt-outs, and why Meta
-- rejected or paused a template.
ALTER TABLE "messages" ADD COLUMN "error_message" TEXT;
ALTER TABLE "contacts" ADD COLUMN "opted_out_at" TIMESTAMP(3);
ALTER TABLE "message_templates" ADD COLUMN "status_reason" TEXT;
