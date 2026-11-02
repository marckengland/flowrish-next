-- CreateTable
CREATE TABLE "ReceptionistConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceptionistConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceptionistCall" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "callSid" TEXT NOT NULL,
    "turn" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,
    "response" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "leadId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceptionistCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceptionistConfig_organizationId_key" ON "ReceptionistConfig"("organizationId");

-- CreateIndex
CREATE INDEX "ReceptionistCall_organizationId_createdAt_idx" ON "ReceptionistCall"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReceptionistCall_organizationId_callSid_key" ON "ReceptionistCall"("organizationId", "callSid");

-- AddForeignKey
ALTER TABLE "ReceptionistConfig" ADD CONSTRAINT "ReceptionistConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceptionistCall" ADD CONSTRAINT "ReceptionistCall_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- These tables are accessed only through authenticated server routes and
-- signed Twilio webhooks. No direct access through the public Data API.
ALTER TABLE "ReceptionistConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReceptionistCall" ENABLE ROW LEVEL SECURITY;

-- RLS does not restrict TRUNCATE. Remove inherited Data API grants as well.
-- Conditional role checks also allow this migration on plain PostgreSQL.
DO $$
DECLARE
    api_role TEXT;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE "ReceptionistConfig", "ReceptionistCall" FROM %I', api_role);
        END IF;
    END LOOP;
END $$;

