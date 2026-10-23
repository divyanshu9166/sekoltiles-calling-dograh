-- Let the Meta App Secret and the Gemini API key be saved from WhatsApp
-- Marketing Settings (encrypted with ENCRYPTION_KEY). When empty, the
-- META_APP_SECRET / GEMINI_API_KEY environment variables are used.
ALTER TABLE "whatsapp_config" ADD COLUMN "app_secret" TEXT;
ALTER TABLE "wa_agent_configs" ADD COLUMN "gemini_api_key" TEXT;
