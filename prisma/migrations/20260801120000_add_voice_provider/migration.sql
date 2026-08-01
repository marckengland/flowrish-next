-- Add the org-wide preferred voice/calling provider.
ALTER TABLE "Organization" ADD COLUMN "voiceProvider" TEXT;
