-- Broadcasts are now sent by a server-side queue worker, so the media header
-- and the reason a whole broadcast failed are stored on the broadcast.
ALTER TABLE "broadcasts" ADD COLUMN "header_media" JSONB;
ALTER TABLE "broadcasts" ADD COLUMN "error_message" TEXT;
