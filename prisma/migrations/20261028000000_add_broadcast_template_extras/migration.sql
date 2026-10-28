-- Header {{1}}, location pin, website link endings and offer code for a
-- broadcast template: the same for every recipient.
ALTER TABLE "broadcasts" ADD COLUMN "template_extras" JSONB;
