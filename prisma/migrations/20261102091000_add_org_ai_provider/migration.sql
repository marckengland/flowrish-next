-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyCiphertext" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyRequestLimit" INTEGER NOT NULL DEFAULT 20,
    "dailyTokenLimit" INTEGER NOT NULL DEFAULT 50000,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 2048,
    "maxInputBytes" INTEGER NOT NULL DEFAULT 16000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "AiUsageDay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "reservedTokens" INTEGER NOT NULL DEFAULT 0,
    "reportedTokens" INTEGER NOT NULL DEFAULT 0,
    "completedRequests" INTEGER NOT NULL DEFAULT 0,
    "failedRequests" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageDay_organizationId_day_key" ON "AiUsageDay"("organizationId", "day");

-- AddForeignKey
ALTER TABLE "AiProviderConfig" ADD CONSTRAINT "AiProviderConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageDay" ADD CONSTRAINT "AiUsageDay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Credentials and organization usage are server-only, including through Supabase's Data API.
ALTER TABLE "AiProviderConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiUsageDay" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiProviderConfig", "AiUsageDay" FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON TABLE "AiProviderConfig", "AiUsageDay" FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
ALTER TABLE "AiProviderConfig" ADD CONSTRAINT "AiProviderConfig_limits_check" CHECK (
 "provider" IN ('deepseek','gemini','openai') AND
 "dailyRequestLimit" BETWEEN 1 AND 1000 AND "dailyTokenLimit" BETWEEN 1000 AND 10000000 AND
 "maxOutputTokens" BETWEEN 128 AND 4096 AND "maxInputBytes" BETWEEN 1000 AND 64000
);
ALTER TABLE "AiUsageDay" ADD CONSTRAINT "AiUsageDay_nonnegative_check" CHECK (
 "requests" >= 0 AND "reservedTokens" >= 0 AND "reportedTokens" >= 0 AND "completedRequests" >= 0 AND "failedRequests" >= 0
);
