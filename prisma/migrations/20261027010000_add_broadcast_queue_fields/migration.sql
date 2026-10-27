-- Broadcasts are now sent by a server-side queue worker, so the media header
-- and the reason a whole broadcast failed are stored on the broadcast.
ALTER TABLE "broadcasts" ADD COLUMN "header_media" JSONB;
ALTER TABLE "broadcasts" ADD COLUMN "error_message" TEXT;

-- Broadcasts the old in-browser sender left unfinished must not be picked up
-- by the new worker: it would re-send them at a random time, and without the
-- header photo they were created with. Close them out instead.
UPDATE "broadcast_recipients"
SET "status" = 'skipped',
    "error_message" = 'Not sent: this broadcast was interrupted before the switch to server-side sending.'
WHERE "status" = 'pending'
  AND "broadcast_id" IN (SELECT "id" FROM "broadcasts" WHERE "status" IN ('sending', 'scheduled'));

UPDATE "broadcasts"
SET "status" = 'failed',
    "error_message" = 'Stopped: this broadcast was being sent from a browser tab and did not finish. Recipients not yet sent to were skipped. Create a new broadcast to reach them.'
WHERE "status" IN ('sending', 'scheduled');
