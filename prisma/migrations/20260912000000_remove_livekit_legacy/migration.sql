-- Dograh is the sole voice orchestration layer. Remove the legacy LiveKit identifier.
ALTER TABLE "CallLog"
  DROP CONSTRAINT IF EXISTS "CallLog_livekitRoomId_key";
ALTER TABLE "CallLog" DROP COLUMN IF EXISTS "livekitRoomId";
