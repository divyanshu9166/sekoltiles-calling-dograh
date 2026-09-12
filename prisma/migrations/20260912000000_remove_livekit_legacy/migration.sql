-- Dograh is the sole voice orchestration layer. Remove the legacy LiveKit identifier.
DROP INDEX IF EXISTS "CallLog_livekitRoomId_key";
ALTER TABLE "CallLog" DROP COLUMN IF EXISTS "livekitRoomId";
