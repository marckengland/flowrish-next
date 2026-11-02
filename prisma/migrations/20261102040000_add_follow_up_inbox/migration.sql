CREATE TABLE "FollowUpSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceThreadId" TEXT,
    "sourceText" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "draftSubject" TEXT NOT NULL DEFAULT '',
    "draftBody" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowUpSuggestion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FollowUpSuggestion_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'DISMISSED')),
    CONSTRAINT "FollowUpSuggestion_sourceType_check" CHECK ("sourceType" IN ('EMAIL', 'CALL'))
);
CREATE UNIQUE INDEX "FollowUpSuggestion_organizationId_sourceKey_key" ON "FollowUpSuggestion"("organizationId", "sourceKey");
CREATE INDEX "FollowUpSuggestion_organizationId_assigneeId_status_createdAt_idx" ON "FollowUpSuggestion"("organizationId", "assigneeId", "status", "createdAt");
ALTER TABLE "FollowUpSuggestion" ADD CONSTRAINT "FollowUpSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpSuggestion" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE api_role TEXT;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE "FollowUpSuggestion" FROM %I', api_role);
        END IF;
    END LOOP;
END $$;

-- Existing unscoped message history is preserved. New syncs have mailbox identity.
ALTER TABLE "EmailMessage" ADD COLUMN "accountId" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN "replyMetadata" JSONB;
DROP INDEX "EmailMessage_externalId_key";
CREATE UNIQUE INDEX "EmailMessage_organizationId_accountId_externalId_key" ON "EmailMessage"("organizationId", "accountId", "externalId");
CREATE INDEX "EmailMessage_organizationId_externalId_idx" ON "EmailMessage"("organizationId", "externalId");
