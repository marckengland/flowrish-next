-- Per-organization bring-your-own voice credentials (secrets encrypted at rest).
CREATE TABLE "VoiceConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "twilioAccountSid" TEXT,
    "twilioApiKeySid" TEXT,
    "twilioApiKeySecret" TEXT,
    "twilioTwimlAppSid" TEXT,
    "twilioCallerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceConfig_organizationId_key" ON "VoiceConfig"("organizationId");

ALTER TABLE "VoiceConfig" ADD CONSTRAINT "VoiceConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
