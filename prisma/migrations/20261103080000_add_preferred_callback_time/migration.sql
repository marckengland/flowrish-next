-- Nullable snapshots preserve legacy callbacks and retain requested timing after source removal.
ALTER TABLE "WebsiteReceptionistCallback" ADD COLUMN "preferredTime" JSONB;
ALTER TABLE "CallbackCrmHandoff" ADD COLUMN "preferredTime" JSONB;
ALTER TABLE "WebsiteReceptionistSession" ADD COLUMN "callbackRequestHash" TEXT;
